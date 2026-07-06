import { beforeEach, describe, expect, it } from 'vitest';
import { createSocialsService, normalizeSource, SocialsService } from '../src/services/socials.service';
import { DomainError } from '../src/types';
import { FakeScansRepo } from './fakes';

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
  let service: SocialsService;

  beforeEach(() => {
    repo = new FakeScansRepo();
    service = createSocialsService({ scans: repo });
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
