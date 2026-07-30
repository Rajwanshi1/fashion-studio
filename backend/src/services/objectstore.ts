// Object storage abstraction for product photo uploads. Two implementations:
//
//   - S3ObjectStore: production — presigned S3 URLs so the admin SPA uploads
//     directly to S3 without the bytes ever passing through the API. Product
//     images live under the public-read `products/` prefix, so their
//     permanent URL (publicUrl) can be stored in products.image_url and
//     served straight into storefront <img> tags.
//   - LocalObjectStore: dev/tests — files under a local directory, with
//     "presigned" URLs pointing at the dev-only /api/uploads/local transport
//     (see routes/uploads.routes.ts). The content type of each object is kept
//     in a JSON sidecar file `<key>.meta` next to the object file.
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ObjectStore {
  presignPut(key: string, contentType: string): Promise<{ url: string; headers: Record<string, string> }>;
  /** Permanent, publicly fetchable URL — only meaningful for public-read prefixes. */
  publicUrl(key: string): string;
  getObject(key: string): Promise<{ bytes: Uint8Array; contentType: string }>;
}

const PUT_EXPIRY_SECONDS = 600; // 10 min

/** `${kind}/${yyyy}/${mm}/${uuid}.jpg` — stable, unguessable, prefix-listable per month. */
export function newStorageKey(kind: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${kind}/${yyyy}/${mm}/${randomUUID()}.jpg`;
}

export interface S3ObjectStoreOptions {
  region?: string;
  /** Injectable for tests — never hit real AWS from a test. */
  client?: S3Client;
}

export class S3ObjectStore implements ObjectStore {
  private client: S3Client;
  private region: string;

  constructor(
    private bucket: string,
    opts: S3ObjectStoreOptions = {},
  ) {
    this.region = opts.region ?? 'ap-south-1';
    this.client = opts.client ?? new S3Client({ region: this.region });
  }

  async presignPut(key: string, contentType: string) {
    // ContentType on the command is part of the signature, so the browser's PUT
    // must send the same Content-Type header or S3 rejects the upload.
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    const url = await getSignedUrl(this.client, command, { expiresIn: PUT_EXPIRY_SECONDS });
    return { url, headers: { 'Content-Type': contentType } };
  }

  /** Virtual-hosted–style URL; requires public read on the key's prefix. */
  publicUrl(key: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async getObject(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`S3 object ${key} has no body`);
    const bytes = await res.Body.transformToByteArray();
    return { bytes, contentType: res.ContentType ?? 'application/octet-stream' };
  }
}

/**
 * Dev/test store. Objects live under `dir` (callers default this to
 * backend/.data/uploads); content type is stored in a `<key>.meta` JSON
 * sidecar. "Presigned" URLs point at the local uploads router, which is only
 * mounted when this store is active.
 */
export class LocalObjectStore implements ObjectStore {
  constructor(
    private dir: string,
    private baseUrl: string,
  ) {}

  /** Resolve a key inside the store dir; rejects path traversal. */
  private resolvePath(key: string): string {
    const root = path.resolve(this.dir);
    const abs = path.resolve(root, key);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return abs;
  }

  private localUrl(key: string): string {
    return `${this.baseUrl}/api/uploads/local/${encodeURIComponent(key)}`;
  }

  async presignPut(key: string, contentType: string) {
    this.resolvePath(key); // validate early so a bad key fails at presign time
    return { url: this.localUrl(key), headers: { 'Content-Type': contentType } };
  }

  publicUrl(key: string): string {
    this.resolvePath(key);
    return this.localUrl(key);
  }

  /** Called by the dev-only PUT transport (and tests) to store the bytes. */
  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const file = this.resolvePath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(`${file}.meta`, JSON.stringify({ contentType }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await readFile(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async getObject(key: string) {
    const file = this.resolvePath(key);
    const bytes = new Uint8Array(await readFile(file));
    let contentType = 'application/octet-stream';
    try {
      const meta = JSON.parse(await readFile(`${file}.meta`, 'utf8'));
      if (typeof meta.contentType === 'string') contentType = meta.contentType;
    } catch {
      // Missing/corrupt sidecar — fall back to the default content type.
    }
    return { bytes, contentType };
  }
}
