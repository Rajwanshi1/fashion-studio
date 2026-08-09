import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogAi, keywordColorFamily, resolveColorFamily } from '../src/services/ai/catalog-ai';
import { AnthropicCatalogAi, CATALOG_AI_EFFORT, CATALOG_AI_MODEL } from '../src/services/ai/catalog-ai-anthropic';
import type { AnthropicMessagesClient } from '../src/services/ai/parser';
import { COLOR_FAMILY_SPEC, IMAGE_NAME_SPEC } from '../src/services/ai/prompts';
import { COLOR_FAMILIES } from '../src/types';

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

/** Fake client whose request never settles — stands in for a hung API call. */
function hangingClient() {
  const client: AnthropicMessagesClient = {
    messages: {
      create() {
        return new Promise(() => {});
      },
    },
  };
  return client;
}

const jsonResponse = (value: unknown) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

const image = { bytes: new Uint8Array([1, 2, 3, 4]), mediaType: 'image/jpeg' };

// Every failure path warns; silence it so a red test is readable.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('keywordColorFamily', () => {
  it.each([
    ['Sage', 'green'],
    ['Cherry Pink', 'pink'], // pink is checked before red, so "cherry" loses
    ['Antique Gold', 'yellow-gold'],
    ['Deep Maroon', 'red'],
    ['Off-white Chanderi', 'white-ivory'],
    ['Printed floral silk', 'multi'], // multi outranks any single colour named
    ['Nude', 'beige-nude'],
  ])('maps %s to %s', (text, family) => {
    expect(keywordColorFamily(text)).toBe(family);
  });

  it('returns null for a colour name with no keyword in it', () => {
    expect(keywordColorFamily('Zephyr')).toBeNull();
  });

  it('anchors on word boundaries, so "tan" does not fire inside "Titanium"', () => {
    expect(keywordColorFamily('Titanium')).toBeNull();
    expect(keywordColorFamily('Tan')).toBe('beige-nude');
  });

  it('is case-insensitive', () => {
    expect(keywordColorFamily('EMERALD')).toBe('green');
  });
});

describe('resolveColorFamily', () => {
  const spyAi = (answer: string | null) => {
    const calls: string[] = [];
    const ai: CatalogAi = {
      async colorFamily(text) {
        calls.push(text);
        return answer as any;
      },
      async nameProductImage() {
        return null;
      },
    };
    return { ai, calls };
  };

  it('short-circuits on a keyword hit without calling the AI', async () => {
    const { ai, calls } = spyAi('multi');
    await expect(resolveColorFamily(ai, 'Sage')).resolves.toBe('green');
    expect(calls).toEqual([]);
  });

  it('consults the AI only when no keyword matches', async () => {
    const { ai, calls } = spyAi('blue');
    await expect(resolveColorFamily(ai, 'Monsoon Sky')).resolves.toBe('blue');
    expect(calls).toEqual(['Monsoon Sky']);
  });

  it('is null when no AI is configured and no keyword matches', async () => {
    await expect(resolveColorFamily(null, 'Zephyr')).resolves.toBeNull();
    // Keyword mapping still works with no key — that is the whole point.
    await expect(resolveColorFamily(null, 'Sage')).resolves.toBe('green');
  });

  it('is null (and never calls out) for empty colour text', async () => {
    const { ai, calls } = spyAi('red');
    await expect(resolveColorFamily(ai, '   ')).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it('passes an AI null straight through', async () => {
    const { ai } = spyAi(null);
    await expect(resolveColorFamily(ai, 'Zephyr')).resolves.toBeNull();
  });
});

describe('AnthropicCatalogAi.colorFamily', () => {
  it('sends the schema as output_config.format with the frozen model, effort and max_tokens', async () => {
    const { client, calls } = fakeClient(jsonResponse({ family: 'green' }));

    await expect(new AnthropicCatalogAi(client).colorFamily('Monsoon Moss')).resolves.toBe('green');

    expect(calls).toHaveLength(1);
    const params = calls[0];
    expect(params.model).toBe(CATALOG_AI_MODEL);
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.max_tokens).toBe(1024);
    expect(params.output_config).toEqual({
      effort: CATALOG_AI_EFFORT,
      format: { type: 'json_schema', schema: COLOR_FAMILY_SPEC.schema },
    });
    expect(CATALOG_AI_EFFORT).toBe('low');
    // Text-only call, and the colour under test travels in the prompt.
    expect(params.messages[0].content).toEqual([
      { type: 'text', text: COLOR_FAMILY_SPEC.prompt('Monsoon Moss') },
    ]);
  });

  it('returns null for a family outside the 12 canonical tokens', async () => {
    const { client } = fakeClient(jsonResponse({ family: 'chartreuse' }));
    await expect(new AnthropicCatalogAi(client).colorFamily('Zephyr')).resolves.toBeNull();
  });

  it('returns null when the model answers null', async () => {
    const { client } = fakeClient(jsonResponse({ family: null }));
    await expect(new AnthropicCatalogAi(client).colorFamily('Zephyr')).resolves.toBeNull();
  });

  it('does not call out at all for empty colour text', async () => {
    const { client, calls } = fakeClient(jsonResponse({ family: 'green' }));
    await expect(new AnthropicCatalogAi(client).colorFamily('  ')).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('accepts every canonical family', async () => {
    for (const family of COLOR_FAMILIES) {
      const { client } = fakeClient(jsonResponse({ family }));
      await expect(new AnthropicCatalogAi(client).colorFamily('Zephyr')).resolves.toBe(family);
    }
  });

  it('logs usage in the same shape as the parser, tagged for catalog assist', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { client } = fakeClient({
      ...jsonResponse({ family: 'pink' }),
      usage: { input_tokens: 420, output_tokens: 12 },
    });

    await new AnthropicCatalogAi(client).colorFamily('Zephyr');

    expect(log).toHaveBeenCalledWith(
      '[catalog-ai] usage',
      expect.objectContaining({
        kind: 'color_family',
        model: 'claude-sonnet-5',
        effort: 'low',
        inputTokens: 420,
        outputTokens: 12,
      }),
    );
  });

  it('returns null (never throws) on a rejected API key', async () => {
    const client = failingClient({
      status: 401,
      error: { error: { type: 'authentication_error', message: 'invalid x-api-key' } },
    });
    await expect(new AnthropicCatalogAi(client).colorFamily('Zephyr')).resolves.toBeNull();
  });

  it('returns null on a refusal', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal', content: [] });
    await expect(new AnthropicCatalogAi(client).colorFamily('Zephyr')).resolves.toBeNull();
  });

  it('returns null on truncated output', async () => {
    const { client } = fakeClient({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"family":' }] });
    await expect(new AnthropicCatalogAi(client).colorFamily('Zephyr')).resolves.toBeNull();
  });

  it('returns null on garbage JSON', async () => {
    const { client } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'sorry, no {' }] });
    await expect(new AnthropicCatalogAi(client).colorFamily('Zephyr')).resolves.toBeNull();
  });

  it('returns null when no text block comes back', async () => {
    const { client } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'thinking' }] });
    await expect(new AnthropicCatalogAi(client).colorFamily('Zephyr')).resolves.toBeNull();
  });

  it('gives up rather than holding a product save open when the API hangs', async () => {
    const ai = new AnthropicCatalogAi(hangingClient(), { timeoutMs: 10 });
    await expect(ai.colorFamily('Zephyr')).resolves.toBeNull();
  });
});

describe('AnthropicCatalogAi.nameProductImage', () => {
  it('sends the image block first, then the prompt naming the product', async () => {
    const { client, calls } = fakeClient(jsonResponse({ file_slug: 'cherry-pink-anarkali-front', pose: 'front' }));

    const result = await new AnthropicCatalogAi(client).nameProductImage(image, 'Cherry Pink Anarkali');
    expect(result).toEqual({ fileSlug: 'cherry-pink-anarkali-front', pose: 'front' });

    const params = calls[0];
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.max_tokens).toBe(1024);
    expect(params.output_config).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema: IMAGE_NAME_SPEC.schema },
    });
    const [imageBlock, textBlock] = params.messages[0].content;
    expect(imageBlock).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(image.bytes).toString('base64') },
    });
    expect(textBlock).toEqual({ type: 'text', text: IMAGE_NAME_SPEC.prompt('Cherry Pink Anarkali') });
    expect(textBlock.text).toContain('Cherry Pink Anarkali');
  });

  it('returns the slug untouched — route-side sanitization is not this seam\'s job', async () => {
    const { client } = fakeClient(jsonResponse({ file_slug: '  Cherry Pink / Anarkali  ', pose: null }));
    await expect(new AnthropicCatalogAi(client).nameProductImage(image, 'Anarkali')).resolves.toEqual({
      fileSlug: 'Cherry Pink / Anarkali',
      pose: null,
    });
  });

  it('returns null when the slug is empty or whitespace', async () => {
    for (const file_slug of ['', '   ']) {
      const { client } = fakeClient(jsonResponse({ file_slug, pose: 'front' }));
      await expect(new AnthropicCatalogAi(client).nameProductImage(image, 'Anarkali')).resolves.toBeNull();
    }
  });

  it('accepts every pose in the enum and nulls anything else', async () => {
    for (const pose of ['front', 'back', 'side', 'detail', 'drape', 'flat']) {
      const { client } = fakeClient(jsonResponse({ file_slug: 'a-b', pose }));
      await expect(new AnthropicCatalogAi(client).nameProductImage(image, 'A')).resolves.toEqual({
        fileSlug: 'a-b',
        pose,
      });
    }
    const { client } = fakeClient(jsonResponse({ file_slug: 'a-b', pose: 'mid-twirl' }));
    await expect(new AnthropicCatalogAi(client).nameProductImage(image, 'A')).resolves.toEqual({
      fileSlug: 'a-b',
      pose: null,
    });
  });

  it('rejects a photo over the 10 MB base64 limit before calling out', async () => {
    const { client, calls } = fakeClient(jsonResponse({ file_slug: 'a-b', pose: 'front' }));
    // Base64 inflates by 4/3, so 8 MB of raw bytes encodes to ~10.7 MB.
    const huge = { bytes: new Uint8Array(8 * 1024 * 1024), mediaType: 'image/jpeg' };
    await expect(new AnthropicCatalogAi(client).nameProductImage(huge, 'A')).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('logs usage tagged image_name', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { client } = fakeClient({
      ...jsonResponse({ file_slug: 'a-b', pose: 'front' }),
      usage: { input_tokens: 1800, output_tokens: 20 },
    });

    await new AnthropicCatalogAi(client).nameProductImage(image, 'A');

    expect(log).toHaveBeenCalledWith(
      '[catalog-ai] usage',
      expect.objectContaining({ kind: 'image_name', model: 'claude-sonnet-5', inputTokens: 1800, outputTokens: 20 }),
    );
  });

  it('returns null (never throws) on a rejected API key, refusal or garbage JSON', async () => {
    const unauthorized = failingClient({
      status: 401,
      error: { error: { type: 'authentication_error', message: 'invalid x-api-key' } },
    });
    await expect(new AnthropicCatalogAi(unauthorized).nameProductImage(image, 'A')).resolves.toBeNull();

    const { client: refused } = fakeClient({ stop_reason: 'refusal', content: [] });
    await expect(new AnthropicCatalogAi(refused).nameProductImage(image, 'A')).resolves.toBeNull();

    const { client: garbage } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: '<html>' }] });
    await expect(new AnthropicCatalogAi(garbage).nameProductImage(image, 'A')).resolves.toBeNull();
  });

  it('gives up rather than holding an upload open when the API hangs', async () => {
    const ai = new AnthropicCatalogAi(hangingClient(), { timeoutMs: 10 });
    await expect(ai.nameProductImage(image, 'A')).resolves.toBeNull();
  });
});

describe('catalog prompt specs', () => {
  it('color family schema is a null-member enum over exactly the 12 families', () => {
    const schema = COLOR_FAMILY_SPEC.schema as any;
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['family']);
    expect(schema.properties.family.enum).toEqual([...COLOR_FAMILIES, null]);
    // A `type` array here would be a union-typed parameter; an enum with a null
    // member is not counted by the API. Keep it that way.
    expect(schema.properties.family.type).toBeUndefined();
  });

  it('image name schema requires both fields and enumerates the poses', () => {
    const schema = IMAGE_NAME_SPEC.schema as any;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['file_slug', 'pose']);
    expect(schema.properties.file_slug.type).toBe('string');
    expect(schema.properties.pose.enum).toEqual(['front', 'back', 'side', 'detail', 'drape', 'flat', null]);
  });

  it('prompts carry their input and explain the tricky cases', () => {
    const colour = COLOR_FAMILY_SPEC.prompt('Antique Gold');
    expect(colour).toContain('Antique Gold');
    expect(colour).toContain('champagne'); // yellow-gold coverage
    expect(colour).toContain('terracotta'); // orange-rust coverage
    expect(colour).toContain('multi');
    expect(colour.length).toBeGreaterThan(200);

    const name = IMAGE_NAME_SPEC.prompt('Sage Green Kaftan');
    expect(name).toContain('Sage Green Kaftan');
    for (const pose of ['front', 'back', 'side', 'detail', 'drape', 'flat']) {
      expect(name).toContain(`"${pose}"`);
    }
  });
});
