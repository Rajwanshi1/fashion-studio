import { beforeEach, describe, expect, it } from 'vitest';
import { createSocialsService, normalizeSource, SocialsService } from '../src/services/socials.service';
import { DomainError } from '../src/types';
import { FakeClicksRepo, FakeScansRepo } from './fakes';

describe('normalizeSource', () => {
  it.each([
    [' Store-Window ', 'store-window'],
    ['packaging_qr', 'packaging_qr'],
    ['a'.repeat(65), null],
    ['', null],
    ['café!', null],
  ])('normalizeSource(%j) -> %j', (input, expected) => {
    expect(normalizeSource(input)).toBe(expected);
  });
});

describe('SocialsService', () => {
  let repo: FakeScansRepo;
  let clicks: FakeClicksRepo;
  let service: SocialsService;

  beforeEach(() => {
    repo = new FakeScansRepo();
    clicks = new FakeClicksRepo();
    service = createSocialsService({ scans: repo, clicks });
  });

  describe('recordScan', () => {
    it('normalizes the source and truncates ua/referer to 512 chars before inserting', async () => {
      const longUa = 'x'.repeat(600);
      const longReferer = 'y'.repeat(600);
      await service.recordScan(' Store-Window ', longUa, longReferer);

      expect(repo.scans).toHaveLength(1);
      expect(repo.scans[0].source).toBe('store-window');
      expect(repo.scans[0].userAgent).toHaveLength(512);
      expect(repo.scans[0].userAgent).toBe(longUa.slice(0, 512));
      expect(repo.scans[0].referer).toHaveLength(512);
      expect(repo.scans[0].referer).toBe(longReferer.slice(0, 512));
    });

    it('records null userAgent/referer as null (no truncation crash)', async () => {
      await service.recordScan('packaging_qr', null, null);
      expect(repo.scans[0]).toMatchObject({ source: 'packaging_qr', userAgent: null, referer: null });
    });

    it('throws DomainError INVALID_SOURCE for an invalid source and inserts nothing', async () => {
      await expect(service.recordScan('café!', null, null)).rejects.toMatchObject({ code: 'INVALID_SOURCE' });
      await expect(service.recordScan('café!', null, null)).rejects.toBeInstanceOf(DomainError);
      expect(repo.scans).toHaveLength(0);
    });

    it('throws DomainError INVALID_SOURCE for an empty source', async () => {
      await expect(service.recordScan('', null, null)).rejects.toMatchObject({ code: 'INVALID_SOURCE' });
    });

    it('throws DomainError INVALID_SOURCE for a too-long source', async () => {
      await expect(service.recordScan('a'.repeat(65), null, null)).rejects.toMatchObject({ code: 'INVALID_SOURCE' });
    });
  });

  describe('recordClick', () => {
    it('normalizes link and source and truncates ua/referer to 512 chars before inserting', async () => {
      const longUa = 'x'.repeat(600);
      await service.recordClick(' WhatsApp ', ' Store-Window ', longUa, 'https://example.com');

      expect(clicks.clicks).toHaveLength(1);
      expect(clicks.clicks[0].link).toBe('whatsapp');
      expect(clicks.clicks[0].source).toBe('store-window');
      expect(clicks.clicks[0].userAgent).toBe(longUa.slice(0, 512));
      expect(clicks.clicks[0].referer).toBe('https://example.com');
    });

    it('keeps the click with null source when source is missing', async () => {
      await service.recordClick('instagram', null, null, null);
      expect(clicks.clicks[0]).toMatchObject({ link: 'instagram', source: null, userAgent: null, referer: null });
    });

    it('keeps the click with null source when source is invalid (click is not lost)', async () => {
      await service.recordClick('instagram', 'café!', null, null);
      expect(clicks.clicks).toHaveLength(1);
      expect(clicks.clicks[0].source).toBeNull();
    });

    it('throws DomainError INVALID_LINK for an invalid link and inserts nothing', async () => {
      await expect(service.recordClick('café!', 'store-window', null, null)).rejects.toMatchObject({ code: 'INVALID_LINK' });
      await expect(service.recordClick('', null, null, null)).rejects.toBeInstanceOf(DomainError);
      expect(clicks.clicks).toHaveLength(0);
    });
  });

  describe('clickStats', () => {
    it('passes through repo.statsByLink() grouped by link and source', async () => {
      await service.recordClick('whatsapp', 'store-window', null, null);
      await service.recordClick('whatsapp', 'store-window', null, null);
      await service.recordClick('whatsapp', null, null, null);
      await service.recordClick('instagram', 'postcard', null, null);

      const stats = await service.clickStats();
      expect(stats).toEqual(await clicks.statsByLink());
      expect(stats[0]).toMatchObject({ link: 'whatsapp', source: 'store-window', total: 2, last7: 2, last30: 2 });
      expect(stats).toContainEqual(expect.objectContaining({ link: 'whatsapp', source: null, total: 1 }));
      expect(stats).toContainEqual(expect.objectContaining({ link: 'instagram', source: 'postcard', total: 1 }));
      expect(stats[0]).toHaveProperty('lastClickAt');
    });
  });

  describe('stats', () => {
    it('passes through repo.statsBySource()', async () => {
      await service.recordScan('instagram-bio', null, null);
      await service.recordScan('instagram-bio', null, null);
      await service.recordScan('packaging-qr', null, null);

      const stats = await service.stats();
      expect(stats).toEqual(await repo.statsBySource());
      expect(stats[0]).toMatchObject({ source: 'instagram-bio', total: 2, last7: 2, last30: 2 });
      expect(stats[1]).toMatchObject({ source: 'packaging-qr', total: 1 });
      expect(stats[0]).toHaveProperty('lastScanAt');
    });
  });
});
