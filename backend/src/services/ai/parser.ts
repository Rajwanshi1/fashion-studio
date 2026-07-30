// Claude-backed document parser. Sends the stored photo plus the kind-specific
// prompt to Claude and returns the schema-conforming draft JSON.
//
// Transport is Amazon Bedrock's Messages-API endpoint (see ./bedrock.ts), so the
// only credential involved is the EC2 instance role — there is no API key
// anywhere. This file stays transport-agnostic apart from the model-id prefix
// below; it takes its client through `AnthropicMessagesClient`, which is what
// lets every test run without touching AWS.
//
// Structured output mechanism (verified against the INSTALLED SDK,
// @anthropic-ai/sdk 0.114.0): `MessageCreateParams.output_config` takes an
// `OutputConfig` whose `format` is a `JSONOutputFormat`
// (`{ type: 'json_schema', schema: {...} }`) and whose `effort` sets thinking
// effort — see node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts
// (OutputConfig at ~L855). With a format set, the response's text block is
// guaranteed-valid JSON conforming to the schema (unless the model refuses or
// output is truncated).
import { PARSE_SPECS, ParseKind } from './prompts';

export type { ParseKind } from './prompts';

export interface BillParser {
  parse(kind: ParseKind, image: { bytes: Uint8Array; mediaType: string }): Promise<unknown>;
}

/**
 * The thin slice of the Anthropic client the parser uses — injectable so tests
 * never touch the real API. Both the first-party client and the Bedrock one
 * satisfy this shape (one cast where they are constructed).
 */
export interface AnthropicMessagesClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      output_config: {
        effort?: string;
        format: { type: 'json_schema'; schema: Record<string, unknown> };
      };
      messages: Array<{
        role: 'user';
        content: Array<
          | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
          | { type: 'text'; text: string }
        >;
      }>;
    }): Promise<{
      stop_reason: string | null;
      content: Array<{ type: string; text?: string }>;
      usage?: {
        input_tokens?: number | null;
        output_tokens?: number | null;
        output_tokens_details?: { thinking_tokens?: number | null } | null;
      } | null;
    }>;
  };
}

/**
 * Adaptive thinking counts toward max_tokens, so this has to cover the thinking
 * budget as well as the JSON. Opus 5 allows 128k output; a truncated draft is
 * useless, and unused budget costs nothing.
 */
const MAX_TOKENS = 32_768;

/** Bedrock rejects images over 5 MB base64 (the first-party API allows 10 MB). */
const MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;

/** Bedrock model ids carry a provider prefix; the tuning file stores bare names. */
const MODEL_PREFIX = 'anthropic.';

/**
 * Raised when the failure is a provisioning problem rather than a bad photo —
 * model access not granted, or an unknown model id. The documents service turns
 * this into the same 503 that a missing parser produces, so the intake wizard
 * falls back to manual entry instead of showing a hard error.
 */
export class ParserUnavailableError extends Error {}

function describeClientError(err: unknown): { message: string; unavailable: boolean } {
  const e = err as { status?: number; message?: string; error?: { error?: { type?: string; message?: string } } };
  const body = e?.error?.error;
  const detail = body?.message ?? e?.message ?? String(err);
  const type = body?.type;
  const status = e?.status;

  // The two failure modes seen while provisioning this, kept distinguishable on
  // purpose: masking the reason is what turns a one-line fix into a long hunt.
  if (status === 403 || type === 'permission_error') {
    return {
      unavailable: true,
      message: `${detail} — enable access to this model in the Bedrock console (Model access) for the region the API calls`,
    };
  }
  if (status === 404 || type === 'not_found_error') {
    return {
      unavailable: true,
      message: `${detail} — check the model id and that the region serves it`,
    };
  }
  return { unavailable: false, message: status ? `${status} ${detail}` : detail };
}

export class AnthropicBillParser implements BillParser {
  /**
   * @param client  the Messages client (Bedrock in every deployed environment).
   * @param modelOverride  forces one model for every kind; only for pinning a
   *   model without a code change. Normally null so PARSE_SPECS decides per kind.
   */
  constructor(
    private client: AnthropicMessagesClient,
    private modelOverride: string | null = null,
  ) {}

  private modelFor(kind: ParseKind): string {
    const bare = this.modelOverride?.trim() || PARSE_SPECS[kind].model;
    return bare.startsWith(MODEL_PREFIX) ? bare : `${MODEL_PREFIX}${bare}`;
  }

  async parse(kind: ParseKind, image: { bytes: Uint8Array; mediaType: string }): Promise<unknown> {
    const spec = PARSE_SPECS[kind];
    const model = this.modelFor(kind);
    const data = Buffer.from(image.bytes).toString('base64');

    if (data.length > MAX_IMAGE_BASE64_BYTES) {
      throw new Error(
        `The ${kind} photo is ${(data.length / 1024 / 1024).toFixed(1)} MB base64, over the 5 MB per-image limit. ` +
          'Re-capture it through the intake wizard, which downscales before upload.',
      );
    }

    const startedAt = Date.now();
    let response: Awaited<ReturnType<AnthropicMessagesClient['messages']['create']>>;
    try {
      response = await this.client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        output_config: { effort: spec.effort, format: { type: 'json_schema', schema: spec.schema } },
        messages: [
          {
            role: 'user',
            // Images before text: Claude reads image-then-text prompts better.
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.mediaType, data } },
              { type: 'text', text: spec.prompt },
            ],
          },
        ],
      });
    } catch (err) {
      const { message, unavailable } = describeClientError(err);
      const wrapped = `Claude could not be reached to parse the ${kind} image (model ${model}): ${message}`;
      throw unavailable ? new ParserUnavailableError(wrapped) : new Error(wrapped);
    }

    // Logged rather than estimated: this is the only honest source of what a
    // parse actually costs, and it lands in CloudWatch next to the request.
    console.log('[parse] usage', {
      kind,
      model,
      effort: spec.effort,
      ms: Date.now() - startedAt,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      thinkingTokens: response.usage?.output_tokens_details?.thinking_tokens ?? null,
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(`Claude refused to parse the ${kind} image (stop_reason: refusal)`);
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error(`Claude output for the ${kind} image was truncated at ${MAX_TOKENS} tokens (stop_reason: max_tokens)`);
    }

    const text = response.content.find((block) => block.type === 'text' && typeof block.text === 'string')?.text;
    if (!text) {
      throw new Error(`Claude returned no text content for the ${kind} image (stop_reason: ${response.stop_reason ?? 'unknown'})`);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Claude returned malformed JSON for the ${kind} image: ${text.slice(0, 200)}`);
    }
  }
}
