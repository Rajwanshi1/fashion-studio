// Claude-backed document parser. Sends the stored photo plus the kind-specific
// prompt to the Claude API and returns the schema-conforming draft JSON.
//
// Structured output mechanism (verified against the INSTALLED SDK,
// @anthropic-ai/sdk 0.114.0): `MessageCreateParams.output_config` takes an
// `OutputConfig` whose `format` is a `JSONOutputFormat`
// (`{ type: 'json_schema', schema: {...} }`) — see
// node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts
// (OutputConfig at ~L854, JSONOutputFormat at ~L622). With a format set, the
// response's text block is guaranteed-valid JSON conforming to the schema
// (unless the model refuses or output is truncated). The legacy top-level
// `output_format` parameter does not exist in this SDK version, and no forced
// tool-use fallback is needed.
import Anthropic from '@anthropic-ai/sdk';
import { PARSE_SPECS, ParseKind } from './prompts';

export type { ParseKind } from './prompts';

export interface BillParser {
  parse(kind: ParseKind, image: { bytes: Uint8Array; mediaType: string }): Promise<unknown>;
}

/**
 * The thin slice of the Anthropic client the parser uses — injectable so tests
 * never touch the real API. The real `Anthropic` client satisfies this shape
 * (one cast at construction, below).
 */
export interface AnthropicMessagesClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      output_config: { format: { type: 'json_schema'; schema: Record<string, unknown> } };
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
    }>;
  };
}

const MAX_TOKENS = 8192;

export class AnthropicBillParser implements BillParser {
  private client: AnthropicMessagesClient;

  constructor(
    apiKey: string,
    private model: string = 'claude-sonnet-5',
    client?: AnthropicMessagesClient,
  ) {
    // The real client's `messages.create` is overloaded (streaming/non-
    // streaming) and typed wider than our narrow seam; the non-streaming call
    // we make is fully compatible, so one contained cast keeps the seam small
    // enough for tests to fake with plain objects.
    this.client = client ?? (new Anthropic({ apiKey }) as unknown as AnthropicMessagesClient);
  }

  async parse(kind: ParseKind, image: { bytes: Uint8Array; mediaType: string }): Promise<unknown> {
    const spec = PARSE_SPECS[kind];
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      output_config: { format: { type: 'json_schema', schema: spec.schema } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mediaType,
                data: Buffer.from(image.bytes).toString('base64'),
              },
            },
            { type: 'text', text: spec.prompt },
          ],
        },
      ],
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
