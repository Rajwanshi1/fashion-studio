// Claude-backed implementation of the catalog AI seam: colour-family mapping
// and SEO image naming.
//
// Both calls sit on paths a human is waiting on — saving a product, uploading a
// photo — and neither is load-bearing: an unmapped colour just misses the shop
// filter, an unnamed photo just gets a uuid key. So NOTHING here throws. Every
// failure (refusal, truncation, malformed JSON, a rejected key, a timeout) is
// warned about and answered with null, and the caller carries on.
//
// Transport is the same injectable seam the document parser uses
// (`AnthropicMessagesClient`, see ./parser.ts), which is what lets the whole
// test suite run offline against a plain object.
import { COLOR_FAMILIES, ColorFamily } from '../../types';
import type { CatalogAi, ImageNameResult } from './catalog-ai';
import type { AnthropicMessagesClient } from './parser';
import { COLOR_FAMILY_SPEC, IMAGE_NAME_SPEC } from './prompts';

/** Both calls are small, mechanical and latency-sensitive — Sonnet at low effort. */
export const CATALOG_AI_MODEL = 'claude-sonnet-5';
export const CATALOG_AI_EFFORT = 'low';

/** Both answers are a handful of tokens; this only has to cover the low-effort thinking. */
const MAX_TOKENS = 1024;

/**
 * The shared client is built with a 10-minute timeout (see ./anthropic.ts —
 * that is what stops the SDK refusing large-`max_tokens` requests outright).
 * That is fine for a background parse and unacceptable on a product save, so
 * these calls get their own much tighter bound on top.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/** The first-party API rejects images over 10 MB base64 (same limit the parser enforces). */
const MAX_IMAGE_BASE64_BYTES = 10 * 1024 * 1024;

const POSES = ['front', 'back', 'side', 'detail', 'drape', 'flat'] as const;

type CallKind = 'color_family' | 'image_name';

type MessageContent = Array<
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'text'; text: string }
>;

function describe(err: unknown): string {
  const e = err as { status?: number; message?: string; error?: { error?: { message?: string } } };
  const detail = e?.error?.error?.message ?? e?.message ?? String(err);
  return e?.status ? `${e.status} ${detail}` : detail;
}

export class AnthropicCatalogAi implements CatalogAi {
  private readonly timeoutMs: number;

  /**
   * @param client  the Messages client (see ./anthropic.ts for the real one).
   * @param options.timeoutMs  per-call bound; only lowered in tests.
   */
  constructor(
    private readonly client: AnthropicMessagesClient,
    options: { timeoutMs?: number } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async colorFamily(colorText: string): Promise<ColorFamily | null> {
    const text = colorText.trim();
    if (!text) return null;

    const answer = await this.ask('color_family', COLOR_FAMILY_SPEC.schema, [
      { type: 'text', text: COLOR_FAMILY_SPEC.prompt(text) },
    ]);
    if (!answer) return null;

    // Trusting the schema here would let a hallucinated family reach a CHECK
    // constraint and 500 a product save, so the enum is re-checked in code.
    const family = answer.family;
    if (typeof family !== 'string' || !(COLOR_FAMILIES as readonly string[]).includes(family)) {
      if (family !== null) {
        console.warn(`[catalog-ai] ignoring colour family "${String(family)}" for "${text}" — not one of the 12 families`);
      }
      return null;
    }
    return family as ColorFamily;
  }

  async nameProductImage(
    image: { bytes: Uint8Array; mediaType: string },
    productName: string,
  ): Promise<ImageNameResult | null> {
    const data = Buffer.from(image.bytes).toString('base64');
    if (data.length > MAX_IMAGE_BASE64_BYTES) {
      console.warn(
        `[catalog-ai] skipping image naming: photo is ${(data.length / 1024 / 1024).toFixed(1)} MB base64, over the 10 MB per-image limit`,
      );
      return null;
    }

    const answer = await this.ask('image_name', IMAGE_NAME_SPEC.schema, [
      // Image before text: Claude reads image-then-text prompts better.
      { type: 'image', source: { type: 'base64', media_type: image.mediaType, data } },
      { type: 'text', text: IMAGE_NAME_SPEC.prompt(productName) },
    ]);
    if (!answer) return null;

    // The slug is returned raw — the upload route sanitizes and uniquifies it.
    const fileSlug = typeof answer.file_slug === 'string' ? answer.file_slug.trim() : '';
    if (!fileSlug) {
      console.warn('[catalog-ai] ignoring image name: model returned an empty file_slug');
      return null;
    }

    const pose = answer.pose;
    const validPose = typeof pose === 'string' && (POSES as readonly string[]).includes(pose) ? pose : null;
    return { fileSlug, pose: validPose };
  }

  /** One structured-output call. Returns the parsed object, or null on any failure. */
  private async ask(
    kind: CallKind,
    schema: Record<string, unknown>,
    content: MessageContent,
  ): Promise<Record<string, unknown> | null> {
    const startedAt = Date.now();
    try {
      const response = await this.withTimeout(
        this.client.messages.create({
          model: CATALOG_AI_MODEL,
          max_tokens: MAX_TOKENS,
          output_config: { effort: CATALOG_AI_EFFORT, format: { type: 'json_schema', schema } },
          messages: [{ role: 'user', content }],
        }),
      );

      // Same shape as '[parse] usage' so both AI paths cost the same to read in
      // CloudWatch — tagged differently because these fire per save/upload.
      console.log('[catalog-ai] usage', {
        kind,
        model: CATALOG_AI_MODEL,
        effort: CATALOG_AI_EFFORT,
        ms: Date.now() - startedAt,
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
      });

      if (response.stop_reason === 'refusal') {
        console.warn(`[catalog-ai] ${kind}: Claude refused (stop_reason: refusal)`);
        return null;
      }
      if (response.stop_reason === 'max_tokens') {
        console.warn(`[catalog-ai] ${kind}: output truncated at ${MAX_TOKENS} tokens (stop_reason: max_tokens)`);
        return null;
      }

      const text = response.content.find((block) => block.type === 'text' && typeof block.text === 'string')?.text;
      if (!text) {
        console.warn(`[catalog-ai] ${kind}: no text content (stop_reason: ${response.stop_reason ?? 'unknown'})`);
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        console.warn(`[catalog-ai] ${kind}: malformed JSON — ${text.slice(0, 200)}`);
        return null;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn(`[catalog-ai] ${kind}: expected a JSON object, got ${JSON.stringify(parsed)?.slice(0, 100)}`);
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      console.warn(`[catalog-ai] ${kind}: ${describe(err)}`);
      return null;
    }
  }

  private withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
    });
    // Both promises are handled by the race, so a late rejection from `work`
    // after a timeout cannot surface as an unhandled rejection.
    return Promise.race([work, bound]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}
