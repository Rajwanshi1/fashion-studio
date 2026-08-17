import { describe, expect, it } from 'vitest';
import { makeUrlRewriter, rewriteLegacyMediaUrl } from '../src/lib/media';

const BUCKET = 'fashion-prod-uploads-123456789012';
const REGION = 'ap-south-1';
const BASE = 'https://media.tanviagnihotry.com';
const LEGACY = `https://${BUCKET}.s3.${REGION}.amazonaws.com/products/2026/08/sage-gown-front-a1b2c3.jpg`;

describe('rewriteLegacyMediaUrl', () => {
  it('swaps the legacy virtual-hosted S3 prefix for the media base', () => {
    expect(rewriteLegacyMediaUrl(LEGACY, BASE, BUCKET, REGION)).toBe(
      `${BASE}/products/2026/08/sage-gown-front-a1b2c3.jpg`,
    );
  });

  it('leaves already-CDN URLs untouched', () => {
    const cdn = `${BASE}/products/2026/08/x.jpg`;
    expect(rewriteLegacyMediaUrl(cdn, BASE, BUCKET, REGION)).toBe(cdn);
  });

  it('leaves foreign URLs untouched (other hosts, other buckets, other regions)', () => {
    const foreign = 'https://cdn.example.com/products/x.jpg';
    const otherBucket = `https://other-bucket.s3.${REGION}.amazonaws.com/products/x.jpg`;
    const otherRegion = `https://${BUCKET}.s3.us-east-1.amazonaws.com/products/x.jpg`;
    expect(rewriteLegacyMediaUrl(foreign, BASE, BUCKET, REGION)).toBe(foreign);
    expect(rewriteLegacyMediaUrl(otherBucket, BASE, BUCKET, REGION)).toBe(otherBucket);
    expect(rewriteLegacyMediaUrl(otherRegion, BASE, BUCKET, REGION)).toBe(otherRegion);
  });

  it('is the identity when the media base or bucket is unset', () => {
    expect(rewriteLegacyMediaUrl(LEGACY, null, BUCKET, REGION)).toBe(LEGACY);
    expect(rewriteLegacyMediaUrl(LEGACY, BASE, null, REGION)).toBe(LEGACY);
  });
});

describe('makeUrlRewriter', () => {
  it('rewrites legacy URLs and passes null through', () => {
    const rw = makeUrlRewriter(BASE, BUCKET, REGION);
    expect(rw(LEGACY)).toBe(`${BASE}/products/2026/08/sage-gown-front-a1b2c3.jpg`);
    expect(rw(null)).toBeNull();
    expect(rw('/img/local.jpg')).toBe('/img/local.jpg');
  });

  it('is the identity function when the CDN is not configured', () => {
    const rw = makeUrlRewriter(null, BUCKET, REGION);
    expect(rw(LEGACY)).toBe(LEGACY);
    expect(rw(null)).toBeNull();
  });
});
