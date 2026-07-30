import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalObjectStore, newStorageKey } from '../src/services/objectstore';

describe('newStorageKey', () => {
  it('produces kind/yyyy/mm/uuid.jpg', () => {
    const key = newStorageKey('bill');
    expect(key).toMatch(/^bill\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/);
  });

  it('is unique per call', () => {
    expect(newStorageKey('bill')).not.toBe(newStorageKey('bill'));
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
