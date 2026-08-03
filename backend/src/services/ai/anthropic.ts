// First-party Claude API transport for the document parser.
//
// The key lives in Secrets Manager as fashion/<env>/anthropic-api-key, is read
// once by instance user-data and reaches the container as ANTHROPIC_API_KEY —
// the same path JWT_SECRET and the DB password already take. Creating or
// rotating the secret therefore takes effect on the next instance refresh, not
// immediately.
//
// Kept in its own module so parser.ts never imports the SDK: that is what lets
// the whole parser test suite run with a plain object as the client.
import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicMessagesClient } from './parser';

/**
 * Why this is set explicitly rather than left to the SDK.
 *
 * On a non-streaming `messages.create` with no `timeout` configured, the SDK
 * refuses to send the request at all when `max_tokens` is large: it estimates
 * 60min * max_tokens / 128000 and throws "Streaming is required for operations
 * that may take longer than 10 minutes" past the 10-minute mark — i.e. for any
 * `max_tokens` above ~21.3k. Our MAX_TOKENS is 32_768 (it has to cover the
 * adaptive thinking budget), so EVERY parse of EVERY kind failed before a
 * single byte left the process.
 *
 * That estimate is a worst-case ceiling, not a prediction: a real bill parse
 * returns in seconds. Setting `timeout` skips the precheck entirely (the SDK
 * only computes it when no timeout is configured) while still bounding the
 * request, which is what we actually want.
 */
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export function createAnthropicClient(
  apiKey: string,
  /** Test seam: lets the SDK's real request path run against a stub transport. */
  fetchImpl?: typeof fetch,
): AnthropicMessagesClient {
  // The real client's `messages.create` is overloaded (streaming/non-streaming)
  // and typed wider than our narrow seam; the non-streaming call we make is
  // fully compatible, so one contained cast keeps the seam small enough for
  // tests to fake with plain objects.
  return new Anthropic({
    apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  }) as unknown as AnthropicMessagesClient;
}
