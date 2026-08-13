import { useState } from 'react';
import { Link } from 'react-router-dom';
import Shop from '../components/Shop';
import ImageSlot from '../components/ImageSlot';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/sizeguide.css';
import { usePageTitle } from '../lib/usePageTitle';

type Unit = 'in' | 'cm';

const ROWS_IN = [
  { s: 'XS', bust: '32"', waist: '26"', hip: '35"', blouse: '14"' },
  { s: 'S', bust: '34"', waist: '28"', hip: '37"', blouse: '14.5"' },
  { s: 'M', bust: '36"', waist: '30"', hip: '39"', blouse: '15"' },
  { s: 'L', bust: '38"', waist: '32"', hip: '41"', blouse: '15.5"' },
  { s: 'XL', bust: '40"', waist: '34"', hip: '43"', blouse: '16"' },
];
const ROWS_CM = [
  { s: 'XS', bust: '81 cm', waist: '66 cm', hip: '89 cm', blouse: '35.5 cm' },
  { s: 'S', bust: '86 cm', waist: '71 cm', hip: '94 cm', blouse: '37 cm' },
  { s: 'M', bust: '91.5 cm', waist: '76 cm', hip: '99 cm', blouse: '38 cm' },
  { s: 'L', bust: '96.5 cm', waist: '81 cm', hip: '104 cm', blouse: '39.5 cm' },
  { s: 'XL', bust: '101.5 cm', waist: '86.5 cm', hip: '109 cm', blouse: '40.5 cm' },
];

export default function SizeGuide() {
  usePageTitle('Size & Fit Guide');
  const [unit, setUnit] = useState<Unit>('in');
  const rows = unit === 'in' ? ROWS_IN : ROWS_CM;

  return (
    <Shop page="page-sizeguide">
      <div className="crumbs">
        <Link to="/client-care">Client Care</Link>
        <span className="sep">/</span>
        <span className="here">Size &amp; Fit</span>
      </div>

      <div className="page-hero">
        <span className="eyebrow">Client Care</span>
        <h1>Size &amp; Fit Guide</h1>
      </div>

      <main className="sg">
        <p className="sg-intro">
          Our pieces follow Indian couture sizing. For the truest fit, we recommend made-to-measure
          — but every standard size can be gently adjusted by our atelier.
        </p>

        <div className="tabs">
          <button className={`tab${unit === 'in' ? ' on' : ''}`} onClick={() => setUnit('in')}>
            Inches
          </button>
          <button className={`tab${unit === 'cm' ? ' on' : ''}`} onClick={() => setUnit('cm')}>
            Centimetres
          </button>
        </div>

        <div className="table-wrap">
          <table className="size">
            <thead>
              <tr>
                <th>Size</th>
                <th>Bust</th>
                <th>Waist</th>
                <th>Hip</th>
                <th>Blouse Length</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.s}>
                  <th>{r.s}</th>
                  <td>{r.bust}</td>
                  <td>{r.waist}</td>
                  <td>{r.hip}</td>
                  <td>{r.blouse}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="swipe-hint">Swipe the table to see all measurements →</div>

        <div className="measure">
          <ImageSlot label="How to measure illustration / photo" />
          <div>
            <span className="eyebrow">How to Measure</span>
            <h2>Three measurements, taken well.</h2>
            <div className="mstep">
              <span className="n">01</span>
              <div>
                <div className="mt">Bust</div>
                <div className="md">Around the fullest part, tape level and snug — not tight.</div>
              </div>
            </div>
            <div className="mstep">
              <span className="n">02</span>
              <div>
                <div className="mt">Waist</div>
                <div className="md">The narrowest part of your natural waistline.</div>
              </div>
            </div>
            <div className="mstep">
              <span className="n">03</span>
              <div>
                <div className="mt">Hip</div>
                <div className="md">Around the fullest part of the hips, feet together.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mto-cta">
          <h2>Prefer it made to measure?</h2>
          <p>
            Book a complimentary virtual fitting and our atelier will craft your piece to your
            exact measurements.
          </p>
          <Link
            className="btn btn-solid"
            style={{ background: 'var(--ink)', color: 'var(--paper)', borderRadius: 999 }}
            to="/contact"
          >
            Book a Fitting
          </Link>
        </div>
      </main>
      <Reveal />
      <Ambient />
    </Shop>
  );
}
