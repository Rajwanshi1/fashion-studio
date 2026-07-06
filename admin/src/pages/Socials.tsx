import { useEffect, useState } from 'react';
import * as QRCode from 'qrcode';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import type { SocialStat } from '../lib/types';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';
import { useToast } from '../components/Toast';

const DEFAULT_SOCIALS_URL = 'https://socials.tanviagnihotry.com';
const SOCIALS_URL =
  (import.meta.env.VITE_SOCIALS_URL as string | undefined) ?? DEFAULT_SOCIALS_URL;

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

const columns: Column<SocialStat>[] = [
  { key: 'source', label: 'Source', render: (s) => <span className="nm">{s.source}</span> },
  { key: 'total', label: 'Total', align: 'right', render: (s) => s.total },
  { key: 'last7', label: 'Last 7 days', align: 'right', render: (s) => s.last7 },
  { key: 'last30', label: 'Last 30 days', align: 'right', render: (s) => s.last30 },
  { key: 'lastScan', label: 'Last scan', render: (s) => formatDate(s.lastScanAt) },
];

export default function Socials() {
  const toast = useToast();
  const [baseUrl, setBaseUrl] = useState(SOCIALS_URL);
  const [source, setSource] = useState('');
  const [qr, setQr] = useState<string | null>(null);

  const [stats, setStats] = useState<SocialStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const slug = normalizeSource(source);
  const isValidSlug = VALID_SOURCE_RE.test(slug);
  const showInvalidSourceWarning = source.trim().length > 0 && !isValidSlug;
  const targetUrl = isValidSlug ? `${baseUrl}/?src=${slug}` : '';

  useEffect(() => {
    let live = true;
    api<{ stats: SocialStat[] }>('/api/socials/stats')
      .then((data) => live && setStats(data.stats))
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
    QRCode.toDataURL(targetUrl, {
      width: 512,
      margin: 2,
      color: { dark: '#1E2620', light: '#FFFFFF' },
    })
      .then((url) => {
        if (live) setQr(url);
      })
      .catch(() => {
        if (live) setQr(null);
      });
    return () => {
      live = false;
    };
  }, [targetUrl]);

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
        </div>

        {qr && slug && (
          <div className="qr-preview">
            <img src={qr} alt={`QR code for ${slug}`} />
            <div className="form-actions">
              <a className="btn-buy gold fit" href={qr} download={`ta-qr-${slug}.png`}>
                Download PNG
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
    </>
  );
}
