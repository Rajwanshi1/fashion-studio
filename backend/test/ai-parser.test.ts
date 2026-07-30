import { describe, expect, it, vi } from 'vitest';
import { AnthropicBillParser, AnthropicMessagesClient, ParseKind, ParserUnavailableError } from '../src/services/ai/parser';
import { PARSE_SPECS } from '../src/services/ai/prompts';

/** Fake Anthropic client — records the request and returns a canned response. */
function fakeClient(response: {
  stop_reason: string | null;
  content: Array<{ type: string; text?: string }>;
  usage?: unknown;
}) {
  const calls: any[] = [];
  const client: AnthropicMessagesClient = {
    messages: {
      async create(params) {
        calls.push(params);
        return response as any;
      },
    },
  };
  return { client, calls };
}

/** Fake client that rejects the way the Anthropic SDK does (status + error body). */
function failingClient(err: unknown) {
  const client: AnthropicMessagesClient = {
    messages: {
      async create() {
        throw err;
      },
    },
  };
  return client;
}

const okShippingReceipt = JSON.stringify({
  carrier: null,
  awb_number: null,
  ship_date: null,
  destination_hint: null,
  notes: null,
});

const image = { bytes: new Uint8Array([1, 2, 3, 4]), mediaType: 'image/jpeg' };

describe('AnthropicBillParser', () => {
  it('sends the image as base64 + the kind prompt with the schema as output_config.format, and returns the parsed JSON', async () => {
    const draft = { carrier: 'DTDC', awb_number: 'D123', ship_date: null, destination_hint: null, notes: null };
    const { client, calls } = fakeClient({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(draft) }],
    });
    const parser = new AnthropicBillParser(client);

    const result = await parser.parse('shipping_receipt', image);
    expect(result).toEqual(draft);

    expect(calls).toHaveLength(1);
    const params = calls[0];
    expect(params.max_tokens).toBe(32_768);
    expect(params.output_config).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema: PARSE_SPECS.shipping_receipt.schema },
    });
    const [imageBlock, textBlock] = params.messages[0].content;
    expect(imageBlock).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(image.bytes).toString('base64') },
    });
    expect(textBlock).toEqual({ type: 'text', text: PARSE_SPECS.shipping_receipt.prompt });
  });

  it('picks the model and effort configured for each kind', async () => {
    const seen: Array<{ model: string; effort: string | undefined }> = [];
    const client: AnthropicMessagesClient = {
      messages: {
        async create(params) {
          seen.push({ model: params.model, effort: params.output_config.effort });
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] };
        },
      },
    };
    const parser = new AnthropicBillParser(client);

    await parser.parse('bill', image);
    await parser.parse('measurement', image);
    await parser.parse('shipping_receipt', image);

    // Opus on the two handwritten kinds is the whole point of the per-kind table.
    expect(seen).toEqual([
      { model: 'claude-opus-5', effort: 'medium' },
      { model: 'claude-opus-5', effort: 'medium' },
      { model: 'claude-sonnet-5', effort: 'low' },
    ]);
  });

  it('lets an override force one model for every kind', async () => {
    const { client, calls } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: okShippingReceipt }] });
    const parser = new AnthropicBillParser(client, 'claude-haiku-4-5');
    await parser.parse('bill', image);
    expect(calls[0].model).toBe('claude-haiku-4-5');
  });

  it('logs token usage so real cost is visible rather than estimated', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { client } = fakeClient({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: okShippingReceipt }],
      usage: { input_tokens: 5400, output_tokens: 1600, output_tokens_details: { thinking_tokens: 900 } },
    });
    await new AnthropicBillParser(client).parse('shipping_receipt', image);

    expect(log).toHaveBeenCalledWith(
      '[parse] usage',
      expect.objectContaining({
        kind: 'shipping_receipt',
        model: 'claude-sonnet-5',
        inputTokens: 5400,
        outputTokens: 1600,
        thinkingTokens: 900,
      }),
    );
    log.mockRestore();
  });

  it('rejects a photo over the 10 MB per-image transport limit before calling out', async () => {
    const calls: any[] = [];
    const client: AnthropicMessagesClient = {
      messages: {
        async create(params) {
          calls.push(params);
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] };
        },
      },
    };
    // Base64 inflates by 4/3, so 8 MB of raw bytes encodes to ~10.7 MB.
    const huge = { bytes: new Uint8Array(8 * 1024 * 1024), mediaType: 'image/jpeg' };
    await expect(new AnthropicBillParser(client).parse('bill', huge)).rejects.toThrow(/over the 10 MB per-image limit/);
    expect(calls).toHaveLength(0);
  });

  it('reports a rejected API key as unavailable, so parsing answers 503 and the wizard falls back', async () => {
    const client = failingClient({
      status: 401,
      error: { error: { type: 'authentication_error', message: 'invalid x-api-key' } },
    });
    const err = await new AnthropicBillParser(client).parse('bill', image).catch((e) => e);
    expect(err).toBeInstanceOf(ParserUnavailableError);
    expect(err.message).toMatch(/invalid x-api-key/);
    expect(err.message).toMatch(/anthropic-api-key/);
  });

  it('reports a spend limit or model permission failure as unavailable', async () => {
    const client = failingClient({
      status: 403,
      error: { error: { type: 'permission_error', message: 'not permitted to use claude-opus-5' } },
    });
    const err = await new AnthropicBillParser(client).parse('bill', image).catch((e) => e);
    expect(err).toBeInstanceOf(ParserUnavailableError);
    expect(err.message).toMatch(/spend limit/);
  });

  it('reports an unknown model id as unavailable too, naming the model it tried', async () => {
    const client = failingClient({
      status: 404,
      error: { error: { type: 'not_found_error', message: "The model 'claude-opus-5' does not exist" } },
    });
    const err = await new AnthropicBillParser(client).parse('bill', image).catch((e) => e);
    expect(err).toBeInstanceOf(ParserUnavailableError);
    expect(err.message).toMatch(/claude-opus-5/);
    expect(err.message).toMatch(/check the model id/);
  });

  it('reports an exhausted credit balance as unavailable, though it arrives as a 400', async () => {
    const client = failingClient({
      status: 400,
      error: { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the API' } },
    });
    const err = await new AnthropicBillParser(client).parse('bill', image).catch((e) => e);
    expect(err).toBeInstanceOf(ParserUnavailableError);
    expect(err.message).toMatch(/top up the Anthropic account/);
  });

  it('treats other transport failures as ordinary errors, keeping the reason', async () => {
    const client = failingClient({ status: 500, error: { error: { type: 'api_error', message: 'internal server error' } } });
    const err = await new AnthropicBillParser(client).parse('bill', image).catch((e) => e);
    expect(err).not.toBeInstanceOf(ParserUnavailableError);
    expect(err.message).toMatch(/internal server error/);
  });

  it('skips thinking blocks and reads the first text block', async () => {
    const { client } = fakeClient({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking' },
        { type: 'text', text: '{"person_name":null,"garment":null,"measurements":[],"notes":null}' },
      ],
    });
    const parser = new AnthropicBillParser(client);
    await expect(parser.parse('measurement', image)).resolves.toMatchObject({ measurements: [] });
  });

  it('throws a descriptive error on malformed JSON output', async () => {
    const { client } = fakeClient({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'sorry, I could not read that {' }],
    });
    const parser = new AnthropicBillParser(client);
    await expect(parser.parse('bill', image)).rejects.toThrow(/malformed JSON for the bill image/);
  });

  it('throws a descriptive error on refusal', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal', content: [] });
    const parser = new AnthropicBillParser(client);
    await expect(parser.parse('bill', image)).rejects.toThrow(/refused to parse the bill image/);
  });

  it('throws a descriptive error on truncated (max_tokens) output', async () => {
    const { client } = fakeClient({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"bill":' }] });
    const parser = new AnthropicBillParser(client);
    await expect(parser.parse('bill', image)).rejects.toThrow(/truncated/);
  });

  it('throws a descriptive error when no text block comes back', async () => {
    const { client } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'thinking' }] });
    const parser = new AnthropicBillParser(client);
    await expect(parser.parse('bill', image)).rejects.toThrow(/no text content/);
  });
});

describe('prompts (PARSE_SPECS)', () => {
  const kinds: ParseKind[] = ['bill', 'measurement', 'shipping_receipt'];

  it.each(kinds)('%s has a non-empty prompt and an object schema', (kind) => {
    const spec = PARSE_SPECS[kind];
    expect(spec.prompt.length).toBeGreaterThan(50);
    expect(spec.schema).toMatchObject({ type: 'object' });
    expect(spec.schema.properties).toBeTypeOf('object');
    expect(Array.isArray(spec.schema.required)).toBe(true);
  });

  it.each(kinds)('%s names a model without the transport prefix, and a valid effort', (kind) => {
    const spec = PARSE_SPECS[kind];
    expect(spec.model).not.toMatch(/^anthropic\./);
    expect(spec.model.length).toBeGreaterThan(0);
    expect(['low', 'medium', 'high']).toContain(spec.effort);
  });

  it('reads the two handwritten kinds with Opus', () => {
    expect(PARSE_SPECS.bill.model).toBe('claude-opus-5');
    expect(PARSE_SPECS.measurement.model).toBe('claude-opus-5');
  });

  it('bill schema marks confidence_notes required and non-nullable', () => {
    const schema = PARSE_SPECS.bill.schema as any;
    expect(schema.required).toContain('confidence_notes');
    expect(schema.properties.confidence_notes.type).toBe('string');
  });

  it('bill money fields are nullable numbers in rupees (no paise fields)', () => {
    const schema = PARSE_SPECS.bill.schema as any;
    const totals = schema.properties.totals;
    for (const field of ['subtotal_rupees', 'gst_rupees', 'total_rupees', 'advance_rupees', 'balance_rupees']) {
      expect(totals.properties[field].type).toEqual(['number', 'null']);
    }
    expect(JSON.stringify(schema)).not.toContain('paise');
  });

  it('measurement values are verbatim strings', () => {
    const schema = PARSE_SPECS.measurement.schema as any;
    expect(schema.properties.measurements.items.properties.value.type).toBe('string');
  });
});
