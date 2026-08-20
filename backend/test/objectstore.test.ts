import { S3Client } from '@aws-sdk/client-s3';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LocalObjectStore,
  S3ObjectStore,
  namedStorageKey,
  newStorageKey,
  sanitizeFileSlug,
} from '../src/services/objectstore';

describe('newStorageKey', () => {
  it('produces kind/yyyy/mm/uuid.jpg', () => {
    const key = newStorageKey('bill');
    expect(key).toMatch(/^bill\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/);
  });

  it('is unique per call', () => {
    expect(newStorageKey('bill')).not.toBe(newStorageKey('bill'));
  });
});

describe('sanitizeFileSlug', () => {
  it('kebab-cases anything the model suggests', () => {
    expect(sanitizeFileSlug('Sage Zardozi Lehenga — Front')).toBe('sage-zardozi-lehenga-front');
    expect(sanitizeFileSlug('  ..Peach/Coral Kaftan!! ')).toBe('peach-coral-kaftan');
  });

  it('caps at 60 chars without leaving a trailing dash', () => {
    const slug = sanitizeFileSlug(`${'a'.repeat(59)} tail`);
    expect(slug).toBe('a'.repeat(59));
    expect(sanitizeFileSlug('x'.repeat(80))).toHaveLength(60);
  });

  it('returns an empty string when nothing usable survives', () => {
    expect(sanitizeFileSlug('!!! ???')).toBe('');
    expect(sanitizeFileSlug('')).toBe('');
  });
});

describe('namedStorageKey', () => {
  it('suffixes the slug with a short uuid under the same monthly prefix', () => {
    const key = namedStorageKey('products', 'sage-zardozi-lehenga-front');
    expect(key).toMatch(/^products\/\d{4}\/\d{2}\/sage-zardozi-lehenga-front-[0-9a-f]{6}\.jpg$/);
    expect(namedStorageKey('products', 'x')).not.toBe(namedStorageKey('products', 'x'));
  });
});

describe('S3ObjectStore', () => {
  /** Static creds so presigning works offline — no call ever leaves the test. */
  const client = new S3Client({
    region: 'ap-south-1',
    credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
  });

  it('publicUrl builds the virtual-hosted S3 form without a public base', () => {
    const store = new S3ObjectStore('fashion-test-uploads', { region: 'ap-south-1', client });
    expect(store.publicUrl('products/2026/08/x.jpg')).toBe(
      'https://fashion-test-uploads.s3.ap-south-1.amazonaws.com/products/2026/08/x.jpg',
    );
  });

  it('publicUrl builds CDN URLs when a public base is configured', () => {
    const store = new S3ObjectStore('fashion-test-uploads', {
      region: 'ap-south-1',
      client,
      publicBaseUrl: 'https://media.tanviagnihotry.com',
    });
    expect(store.publicUrl('products/2026/08/x.jpg')).toBe(
      'https://media.tanviagnihotry.com/products/2026/08/x.jpg',
    );
  });

  it('presignPut echoes Cache-Control as a header the client must send', async () => {
    const store = new S3ObjectStore('fashion-test-uploads', { region: 'ap-south-1', client });
    const cc = 'public,max-age=31536000,immutable';
    const { url, headers } = await store.presignPut('products/2026/08/x.jpg', 'image/jpeg', cc);
    // S3 stores exactly the Cache-Control header that arrives with the PUT —
    // the returned map is the ONLY thing that puts it on the wire, so it must
    // carry both headers verbatim. (This SDK version signs host only:
    // X-Amz-SignedHeaders=host — nothing else to assert on the URL.)
    expect(headers).toEqual({ 'Content-Type': 'image/jpeg', 'Cache-Control': cc });
    expect(url).toContain('X-Amz-Signature=');
  });

  it('presignPut without cacheControl keeps the original header contract', async () => {
    const store = new S3ObjectStore('fashion-test-uploads', { region: 'ap-south-1', client });
    const { headers } = await store.presignPut('products/2026/08/x.jpg', 'image/jpeg');
    expect(headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });
});

describe('LocalObjectStore', () => {
  let dir: string;
  let store: LocalObjectStore;
  const baseUrl = 'http://localhost:4000';

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'objectstore-test-'));
    store = new LocalObjectStore(dir, baseUrl);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips bytes and content type through put + getObject', async () => {
    const key = newStorageKey('measurement');
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

    // Simulate the PUT transport by calling the store directly.
    await store.put(key, bytes, 'image/png');

    const obj = await store.getObject(key);
    expect(Array.from(obj.bytes)).toEqual(Array.from(bytes));
    expect(obj.contentType).toBe('image/png');
  });

  it('presignPut returns the local transport URL with the key percent-encoded, plus the Content-Type header', async () => {
    const key = 'bill/2026/07/abc.jpg';
    const { url, headers } = await store.presignPut(key, 'image/jpeg');
    expect(url).toBe(`${baseUrl}/api/uploads/local/${encodeURIComponent(key)}`);
    expect(url).toContain('bill%2F2026%2F07%2Fabc.jpg');
    expect(headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('presignPut accepts and ignores cacheControl (dev CORS only allows Content-Type/Authorization)', async () => {
    const { headers } = await store.presignPut('bill/2026/07/abc.jpg', 'image/jpeg', 'public,max-age=31536000,immutable');
    expect(headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('presignGet returns the same-shaped local URL', async () => {
    const key = 'bill/2026/07/abc.jpg';
    const url = await store.presignGet(key);
    expect(url).toBe(`${baseUrl}/api/uploads/local/${encodeURIComponent(key)}`);
  });

  it('getObject falls back to application/octet-stream when the sidecar is missing', async () => {
    const key = 'bill/2026/07/no-meta.jpg';
    await store.put(key, new Uint8Array([1]), 'image/jpeg');
    // Delete the sidecar to simulate a legacy/corrupt state.
    await rm(path.join(dir, `${key}.meta`));
    const obj = await store.getObject(key);
    expect(obj.contentType).toBe('application/octet-stream');
  });

  it('exists reflects whether the object was stored', async () => {
    const key = newStorageKey('bill');
    expect(await store.exists(key)).toBe(false);
    await store.put(key, new Uint8Array([1]), 'image/jpeg');
    expect(await store.exists(key)).toBe(true);
  });

  it('rejects path-traversal keys', async () => {
    await expect(store.put('../escape.jpg', new Uint8Array([1]), 'image/jpeg')).rejects.toThrow(/Invalid storage key/);
    await expect(store.getObject('bill/../../escape.jpg')).rejects.toThrow(/Invalid storage key/);
    await expect(store.presignPut('../../etc/passwd', 'image/jpeg')).rejects.toThrow(/Invalid storage key/);
  });
});
