import { useEffect, useState } from 'react';
import * as QRCode from 'qrcode';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import type { LinkClickStat, SocialStat } from '../lib/types';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';
import { useToast } from '../components/Toast';

/**
 * Always the production origin, whatever environment this build targets —
 * printed QR codes outlive any staging deployment.
 */
const SOCIALS_URL = 'https://tanviagnihotry.com/qr-socials';

/**
 * Live-preview helper only — NOT what the backend does. The backend's
 * normalizeSource (backend/src/services/socials.service.ts) trims, lowercases,
 * and collapses whitespace runs to '-', then REJECTS the result outright if it
 * doesn't match VALID_SOURCE_RE (it never strips characters). This admin-side
 * version strips disallowed chars instead, purely so the QR/link preview looks
 * sane as the user types. VALID_SOURCE_RE below is what keeps the two paths
 * equivalent in practice: for any input this function accepts unchanged, the
 * backend's stricter validate-or-reject logic produces the same result.
 */
export function normalizeSource(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

/** Mirrors backend/src/services/socials.service.ts SOURCE_RE — the scan route rejects anything else. */
const VALID_SOURCE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const QR_DARK = '#1E2620';
const DEFAULT_BG = '#ffffff';
/** RGBA hex — the qrcode lib renders a fully transparent background. */
const TRANSPARENT_BG = '#ffffff00';

/** '#abc', 'abc', '#aabbcc', 'AABBCC' → '#aabbcc'; anything else → null. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(raw))
    return `#${[...raw].map((c) => c + c).join('').toLowerCase()}`;
  return null;
}

/** WCAG relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const chan = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
}

/** Scanners need the dark modules to stand out from the background. */
function isLowContrast(bg: string): boolean {
  const [hi, lo] = [luminance(bg), luminance(QR_DARK)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05) < 2;
}

const columns: Column<SocialStat>[] = [
  { key: 'source', label: 'Source', render: (s) => <span className="nm">{s.source}</span> },
  { key: 'total', label: 'Total', align: 'right', render: (s) => s.total },
  { key: 'last7', label: 'Last 7 days', align: 'right', render: (s) => s.last7 },
  { key: 'last30', label: 'Last 30 days', align: 'right', render: (s) => s.last30 },
  { key: 'lastScan', label: 'Last scan', render: (s) => formatDate(s.lastScanAt) },
];

const clickColumns: Column<LinkClickStat>[] = [
  { key: 'link', label: 'Link', render: (c) => <span className="nm">{c.link}</span> },
  { key: 'source', label: 'From QR', render: (c) => c.source ?? 'direct' },
  { key: 'total', label: 'Total', align: 'right', render: (c) => c.total },
  { key: 'last7', label: 'Last 7 days', align: 'right', render: (c) => c.last7 },
  { key: 'last30', label: 'Last 30 days', align: 'right', render: (c) => c.last30 },
  { key: 'lastClick', label: 'Last click', render: (c) => formatDate(c.lastClickAt) },
];

export default function Socials() {
  const toast = useToast();
  const [baseUrl, setBaseUrl] = useState(SOCIALS_URL);
  const [source, setSource] = useState('');
  const [bg, setBg] = useState(DEFAULT_BG);
  /** Free-text mirror of `bg` — lets a hex code be pasted/typed without yanking the QR to invalid values. */
  const [bgText, setBgText] = useState(DEFAULT_BG);
  const [qr, setQr] = useState<{ colored: string; transparent: string } | null>(null);

  const [stats, setStats] = useState<SocialStat[] | null>(null);
  const [clicks, setClicks] = useState<LinkClickStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const slug = normalizeSource(source);
  const isValidSlug = VALID_SOURCE_RE.test(slug);
  const showInvalidSourceWarning = source.trim().length > 0 && !isValidSlug;
  const targetUrl = isValidSlug ? `${baseUrl}/?src=${slug}` : '';

  useEffect(() => {
    let live = true;
    api<{ stats: SocialStat[]; clicks: LinkClickStat[] }>('/api/socials/stats')
      .then((data) => {
        if (!live) return;
        setStats(data.stats);
        setClicks(data.clicks ?? []);
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!targetUrl) {
      setQr(null);
      return;
    }
    let live = true;
    const render = (light: string) =>
      QRCode.toDataURL(targetUrl, { width: 512, margin: 2, color: { dark: QR_DARK, light } });
    Promise.all([render(bg), render(TRANSPARENT_BG)])
      .then(([colored, transparent]) => {
        if (live) setQr({ colored, transparent });
      })
      .catch(() => {
        if (live) setQr(null);
      });
    return () => {
      live = false;
    };
  }, [targetUrl, bg]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(targetUrl);
      toast('URL copied');
    } catch {
      toast('Unable to copy — copy it manually');
    }
  };

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The House · Reach</span>
        <h1>Socials</h1>
      </div>

      <p className="section-label" style={{ marginTop: 0 }}>
        Create a QR
      </p>
      <div className="form-card qr-panel">
        <div className="qr-fields">
          <div className="grid2">
            <div className="field">
              <label className="lab" htmlFor="s-base">
                Base URL
              </label>
              <input
                id="s-base"
                className="inp"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="lab" htmlFor="s-source">
                Source
              </label>
              <input
                id="s-source"
                className="inp"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. Store Window"
              />
            </div>
            <div className="field">
              <label className="lab" htmlFor="s-bg">
                Background
              </label>
              <div className="color-row">
                <input
                  id="s-bg"
                  className="inp"
                  type="color"
                  value={bg}
                  onChange={(e) => {
                    setBg(e.target.value);
                    setBgText(e.target.value);
                  }}
                />
                <input
                  id="s-bg-hex"
                  className="inp"
                  aria-label="Background hex"
                  placeholder="#ffffff"
                  maxLength={7}
                  value={bgText}
                  onChange={(e) => {
                    setBgText(e.target.value);
                    const hex = normalizeHex(e.target.value);
                    if (hex) setBg(hex);
                  }}
                  onBlur={() => setBgText(bg)}
                />
              </div>
            </div>
          </div>

          <p className="state-note">
            Slug: <strong className="slug">{slug || '—'}</strong>
          </p>
          {targetUrl && (
            <p className="state-note">
              Target URL: <code>{targetUrl}</code>
            </p>
          )}
          {showInvalidSourceWarning && (
            <div className="form-err" role="alert">
              Invalid source — must start with a letter or number and contain only lowercase
              letters, numbers, "_" or "-" (max 64 characters). A QR printed from this label
              would have every scan rejected.
            </div>
          )}
          {isValidSlug && isLowContrast(bg) && (
            <div className="form-err" role="alert">
              Low contrast — the dark modules barely stand out from this background; scanners
              may not read a QR printed with it.
            </div>
          )}
        </div>

        {qr && slug && (
          <div className="qr-preview">
            <img src={qr.colored} alt={`QR code for ${slug}`} />
            <div className="form-actions">
              <a className="btn-buy gold fit" href={qr.colored} download={`ta-qr-${slug}.png`}>
                Download PNG
              </a>
              <a
                className="btn-outline fit"
                href={qr.transparent}
                download={`ta-qr-${slug}-transparent.png`}
              >
                Transparent PNG
              </a>
              <button type="button" className="btn-outline fit" onClick={() => void copyUrl()}>
                Copy URL
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="section-label">Scans by source</p>
      {error && <p className="state-note">{error}</p>}
      {!stats && !error && <p className="state-note">Loading scans…</p>}
      {stats && (
        <DataTable
          columns={columns}
          rows={stats}
          rowKey={(s) => s.source}
          empty="No scans yet — print a QR and place it."
        />
      )}

      <p className="section-label">Clicks by link</p>
      {!clicks && !error && <p className="state-note">Loading clicks…</p>}
      {clicks && (
        <DataTable
          columns={clickColumns}
          rows={clicks}
          rowKey={(c) => `${c.link}|${c.source ?? ''}`}
          empty="No clicks yet — they appear once visitors tap a link on the socials page."
        />
      )}
    </>
  );
}
