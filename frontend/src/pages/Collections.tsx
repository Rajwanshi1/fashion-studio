import { Link } from 'react-router-dom';
import Shop from '../components/Shop';
import ImageSlot from '../components/ImageSlot';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/collections.css';
import { usePageTitle } from '../lib/usePageTitle';

const COLLECTIONS = [
  {
    tall: true,
    to: '/collection/lehenga',
    label: 'The Verdant Edit',
    num: 'Spring 2026 · 24 Pieces',
    title: 'The Verdant Edit',
    blurb: 'Moss, sage and pistachio. Our signature indo-western silhouettes in a garden of greens.',
    go: 'Explore →',
  },
  {
    tall: true,
    to: '/collection/lehenga',
    label: 'Bridal',
    num: 'Bridal · 18 Pieces',
    title: 'The Bridal Atelier',
    blurb:
      "Heirloom lehengas and capes in zardozi and mirror, crafted for the day you'll remember forever.",
    go: 'Explore →',
  },
  {
    tall: false,
    to: '/collection/anarkali',
    label: 'Festive',
    num: 'Festive · 21 Pieces',
    title: 'Festive Lights',
    blurb: 'Anarkalis, shararas and drapes for the season of celebration.',
    go: 'Explore →',
  },
  {
    tall: false,
    to: '/collection/kaftan',
    label: 'Occasion',
    num: 'Occasion · 16 Pieces',
    title: 'Cocktail & Reception',
    blurb: 'Fluid kaftans and anti-fit drapes for the modern evening.',
    go: 'Explore →',
  },
  {
    tall: false,
    to: '/collection/suits',
    label: 'Heritage',
    num: 'Heritage · 12 Pieces',
    title: 'The Heritage Revival',
    blurb: 'Archival techniques — chikankari, mukaish, gota — reimagined.',
    go: 'Explore →',
  },
  {
    tall: false,
    to: '/contact',
    label: 'Made to Measure',
    num: 'Made to Measure',
    title: 'By Commission',
    blurb: 'A piece designed with you, cut to your exact measure.',
    go: 'Book a Fitting →',
  },
];

export default function Collections() {
  usePageTitle('Collections');
  return (
    <Shop page="page-collections">
      <div className="crumbs">
        <Link to="/">Home</Link>
        <span className="sep">/</span>
        <span className="here">Collections</span>
      </div>

      <div className="page-hero">
        <span className="eyebrow">The House</span>
        <h1>Collections</h1>
      </div>
      <div className="intro">
        <p className="lede">
          Each collection is a season of craft — conceived in the studio, embroidered by hand, and
          cut for the modern Indian woman.
        </p>
      </div>

      <main className="coll-grid">
        {COLLECTIONS.map((c) => (
          <Link className={`coll${c.tall ? ' tall' : ''}`} key={c.title} to={c.to}>
            <ImageSlot label={c.label} />
            <div className="cc">
              <span className="num">{c.num}</span>
              <h2>{c.title}</h2>
              <p>{c.blurb}</p>
              <span className="go">{c.go}</span>
            </div>
          </Link>
        ))}
      </main>
      <Reveal />
      <Ambient />
    </Shop>
  );
}
