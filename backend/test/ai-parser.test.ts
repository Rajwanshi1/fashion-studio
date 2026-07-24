import { describe, expect, it } from 'vitest';
import { AnthropicBillParser, AnthropicMessagesClient, ParseKind } from '../src/services/ai/parser';
import { PARSE_SPECS } from '../src/services/ai/prompts';

/** Fake Anthropic client — records the request and returns a canned response. */
function fakeClient(response: { stop_reason: string | null; content: Array<{ type: string; text?: string }> }) {
  const calls: any[] = [];
  const client: AnthropicMessagesClient = {
    messages: {
      async create(params) {
        calls.push(params);
        return response;
      },
    },
  };
  return { client, calls };
}

const image = { bytes: new Uint8Array([1, 2, 3, 4]), mediaType: 'image/jpeg' };

describe('AnthropicBillParser', () => {
  it('sends the image as base64 + the kind prompt with the schema as output_config.format, and returns the parsed JSON', async () => {
    const draft = { carrier: 'DTDC', awb_number: 'D123', ship_date: null, destination_hint: null, notes: null };
    const { client, calls } = fakeClient({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(draft) }],
    });
    const parser = new AnthropicBillParser('sk-test', 'claude-sonnet-5', client);

    const result = await parser.parse('shipping_receipt', image);
    expect(result).toEqual(draft);

    expect(calls).toHaveLength(1);
    const params = calls[0];
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.max_tokens).toBe(8192);
    expect(params.output_config).toEqual({
      format: { type: 'json_schema', schema: PARSE_SPECS.shipping_receipt.schema },
    });
    const [imageBlock, textBlock] = params.messages[0].content;
    expect(imageBlock).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(image.bytes).toString('base64') },
    });
    expect(textBlock).toEqual({ type: 'text', text: PARSE_SPECS.shipping_receipt.prompt });
  });

  it('skips thinking blocks and reads the first text block', async () => {
    const { client } = fakeClient({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking' },
        { type: 'text', text: '{"person_name":null,"garment":null,"measurements":[],"notes":null}' },
      ],
    });
    const parser = new AnthropicBillParser('sk-test', 'claude-sonnet-5', client);
    await expect(parser.parse('measurement', image)).resolves.toMatchObject({ measurements: [] });
  });

  it('throws a descriptive error on malformed JSON output', async () => {
    const { client } = fakeClient({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'sorry, I could not read that {' }],
    });
    const parser = new AnthropicBillParser('sk-test', 'claude-sonnet-5', client);
    await expect(parser.parse('bill', image)).rejects.toThrow(/malformed JSON for the bill image/);
  });

  it('throws a descriptive error on refusal', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal', content: [] });
    const parser = new AnthropicBillParser('sk-test', 'claude-sonnet-5', client);
    await expect(parser.parse('bill', image)).rejects.toThrow(/refused to parse the bill image/);
  });

  it('throws a descriptive error on truncated (max_tokens) output', async () => {
    const { client } = fakeClient({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"bill":' }] });
    const parser = new AnthropicBillParser('sk-test', 'claude-sonnet-5', client);
    await expect(parser.parse('bill', image)).rejects.toThrow(/truncated/);
  });

  it('throws a descriptive error when no text block comes back', async () => {
    const { client } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'thinking' }] });
    const parser = new AnthropicBillParser('sk-test', 'claude-sonnet-5', client);
    await expect(parser.parse('bill', image)).rejects.toThrow(/no text content/);
  });

  it('defaults the model to claude-sonnet-5', async () => {
    const { client, calls } = fakeClient({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"carrier":null,"awb_number":null,"ship_date":null,"destination_hint":null,"notes":null}' }],
    });
    const parser = new AnthropicBillParser('sk-test', undefined, client);
    await parser.parse('shipping_receipt', image);
    expect(calls[0].model).toBe('claude-sonnet-5');
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
