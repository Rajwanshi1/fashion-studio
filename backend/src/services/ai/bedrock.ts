// Bedrock transport for the document parser.
//
// This is Bedrock's Messages-API endpoint ("Claude in Amazon Bedrock",
// bedrock-mantle.{region}.api.aws/anthropic/v1/messages), NOT the older
// InvokeModel/Converse path — it takes the same request body as the first-party
// API, which is why parser.ts needs no transport-specific branches.
//
// Credentials come from the standard AWS chain, so on EC2 the instance role
// signs every call and no API key exists anywhere. The container can reach IMDS
// because the launch template sets an IMDSv2 hop limit of 2 (added for the S3
// uploads work), which is the same mechanism S3ObjectStore relies on.
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import type { AnthropicMessagesClient } from './parser';

/** Region comes from config (see DEFAULT_BEDROCK_REGION there for why not ap-south-1). */
export function createBedrockClient(region: string): AnthropicMessagesClient {
  // The real client's `messages.create` is overloaded (streaming/non-streaming)
  // and typed wider than our narrow seam; the non-streaming call we make is
  // fully compatible, so one contained cast keeps the seam small enough for
  // tests to fake with plain objects.
  return new AnthropicBedrockMantle({ awsRegion: region }) as unknown as AnthropicMessagesClient;
}
