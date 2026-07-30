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

export function createAnthropicClient(apiKey: string): AnthropicMessagesClient {
  // The real client's `messages.create` is overloaded (streaming/non-streaming)
  // and typed wider than our narrow seam; the non-streaming call we make is
  // fully compatible, so one contained cast keeps the seam small enough for
  // tests to fake with plain objects.
  return new Anthropic({ apiKey }) as unknown as AnthropicMessagesClient;
}
