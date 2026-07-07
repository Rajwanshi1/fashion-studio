import type { ClicksRepo, LinkStats } from '../data/clicks.repo';
import type { ScansRepo, SourceStats } from '../data/scans.repo';
import { DomainError } from '../types';

const SOURCE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_HEADER_LEN = 512;

/**
 * trim -> lowercase -> collapse whitespace runs to '-' -> validate charset/length.
 * Returns the normalized source, or null when it doesn't satisfy the charset rule.
 */
export function normalizeSource(raw: string): string | null {
  const collapsed = raw.trim().toLowerCase().replace(/\s+/g, '-');
  return SOURCE_RE.test(collapsed) ? collapsed : null;
}

export interface SocialsService {
  recordScan(source: string, userAgent: string | null, referer: string | null): Promise<void>;
  recordClick(link: string, source: string | null, userAgent: string | null, referer: string | null): Promise<void>;
  stats(): Promise<SourceStats[]>;
  clickStats(): Promise<LinkStats[]>;
}

export function createSocialsService(deps: { scans: ScansRepo; clicks: ClicksRepo }): SocialsService {
  return {
    async recordScan(source, userAgent, referer) {
      const normalized = normalizeSource(source);
      if (!normalized) throw new DomainError('INVALID_SOURCE', `Invalid scan source: '${source}'`);
      const ua = userAgent ? userAgent.slice(0, MAX_HEADER_LEN) : null;
      const ref = referer ? referer.slice(0, MAX_HEADER_LEN) : null;
      await deps.scans.insert(normalized, ua, ref);
    },

    async recordClick(link, source, userAgent, referer) {
      const normalizedLink = normalizeSource(link);
      if (!normalizedLink) throw new DomainError('INVALID_LINK', `Invalid click link: '${link}'`);
      // Attribution is best-effort: a garbage source must not lose the click.
      const normalizedSource = source ? normalizeSource(source) : null;
      const ua = userAgent ? userAgent.slice(0, MAX_HEADER_LEN) : null;
      const ref = referer ? referer.slice(0, MAX_HEADER_LEN) : null;
      await deps.clicks.insert(normalizedLink, normalizedSource, ua, ref);
    },

    stats() {
      return deps.scans.statsBySource();
    },

    clickStats() {
      return deps.clicks.statsByLink();
    },
  };
}
