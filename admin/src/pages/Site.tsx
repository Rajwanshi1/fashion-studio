import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { SECTIONS, SECTION_DEFAULTS, sectionPreview } from '../lib/siteContent';
import type { SectionConfig } from '../lib/siteContent';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function SectionCard({
  config,
  stored,
}: {
  config: SectionConfig;
  stored: Record<string, unknown> | null;
}) {
  // The card previews what the site actually shows: the saved section if there
  // is one, otherwise the built-in default.
  const value = { ...SECTION_DEFAULTS[config.key], ...(stored ?? {}) };
  const imageUrl = typeof value.imageUrl === 'string' && value.imageUrl ? value.imageUrl : null;
  const preview = sectionPreview(config.key, value);

  return (
    <Link className="site-card" to={`/site/${config.key}`}>
      {imageUrl ? (
        <img className="site-thumb" src={imageUrl} alt="" />
      ) : (
        <span className="site-thumb mono" aria-hidden="true">
          {config.title.charAt(0)}
        </span>
      )}
      <span className="site-card-text">
        <span className="where">{config.blurb}</span>
        <span className="nm">{config.title}</span>
        {preview && <span className="prev">{preview}</span>}
      </span>
      <span className={`badge ${stored ? 'custom' : 'default'}`}>
        {stored ? 'Customised' : 'Default'}
      </span>
    </Link>
  );
}

export default function Site() {
  const [sections, setSections] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<{ sections: Record<string, unknown> }>('/api/content')
      .then((data) => {
        if (live) setSections(isRecord(data.sections) ? data.sections : {});
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The House · Storefront</span>
        <h1>Site</h1>
        <p className="sub">What the boutique shows the world — tap a card to edit.</p>
      </div>

      {error && <p className="state-note">{error}</p>}
      {!sections && !error && <p className="state-note">Loading sections…</p>}
      {sections && (
        <div className="site-cards">
          {SECTIONS.map((config) => {
            const stored = sections[config.key];
            return (
              <SectionCard
                key={config.key}
                config={config}
                stored={isRecord(stored) ? stored : null}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
