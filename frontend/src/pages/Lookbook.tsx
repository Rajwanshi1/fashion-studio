import { Link } from 'react-router-dom';
import Shop from '../components/Shop';
import ImageSlot from '../components/ImageSlot';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/lookbook.css';

export default function Lookbook() {
  return (
    <Shop page="page-lookbook">
      <header className="lb-cover">
        <ImageSlot label="Lookbook cover — full bleed editorial" />
        <div className="cc">
          <div className="masthead">The Edit</div>
          <div className="sub">
            <span>Volume 01</span>
            <span>·</span>
            <span>Spring 2026</span>
            <span>·</span>
            <span>32 Looks</span>
          </div>
        </div>
        <div className="scroll">Scroll to enter ↓</div>
      </header>

      <main className="lb">
        <section className="spread text-left">
          <div className="caption">
            <span className="look-no">Look 01</span>
            <h3>The garden, after rain.</h3>
            <p>Sage sequin jacket lehenga with a hand-draped dupatta. Structured shoulder, fluid hem.</p>
            <Link className="shop-look" to="/collection/lehenga">
              Shop the Look →
            </Link>
          </div>
          <ImageSlot className="ar54" label="Look 01 — wide" />
        </section>

        <section className="spread duo">
          <ImageSlot className="ar34" label="Look 02" />
          <ImageSlot className="ar34" label="Look 03" />
        </section>

        <div className="pull">
          <blockquote>
            "She does not choose between heritage and the present. She wears both, at once."
          </blockquote>
          <cite>— The Verdant Edit</cite>
        </div>

        <section className="spread offset">
          <ImageSlot className="ar45" label="Look 04 — large" />
          <div className="caption">
            <span className="look-no">Look 04</span>
            <h3>Moss &amp; mirror.</h3>
            <p>A tissue draped gown caught with mirror-work — light moving as you do.</p>
            <Link className="shop-look" to="/collection/kaftan">
              Shop the Look →
            </Link>
          </div>
        </section>

        <section className="spread duo">
          <ImageSlot className="ar34" label="Look 05" />
          <ImageSlot className="ar34" label="Look 06" />
        </section>

        <section className="spread">
          <ImageSlot className="ar54" label="Look 07 — full bleed" />
        </section>
      </main>
      <Reveal />
      <Ambient />
    </Shop>
  );
}
