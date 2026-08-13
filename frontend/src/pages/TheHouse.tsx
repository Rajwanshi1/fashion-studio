import { Link } from 'react-router-dom';
import Shop from '../components/Shop';
import ImageSlot from '../components/ImageSlot';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/house.css';
import { usePageTitle } from '../lib/usePageTitle';

export default function TheHouse() {
  usePageTitle('The House');
  return (
    <Shop page="page-house">
      <header className="house-hero">
        <ImageSlot label="Atelier / founder portrait — full bleed" />
        <div className="ht">
          <span className="eyebrow">The House of Tanvi Agnihotry</span>
          <h1>
            jahan har rang
            <br />
            ek kissa sunata hai.
          </h1>
        </div>
      </header>

      {/* Open with a fact only this house has — facts age well, manifestos
          don't (audit §04, §06). */}
      <section className="manifesto">
        <p className="lede">
          Tanvi Agnihotry began in a Bapu Nagar workroom in Jaipur, with one length of silk and a
          karigar who had been setting zardozi for thirty years. That workroom is still where
          every piece is made.
        </p>
        <p>
          Ours is a made-to-order house built on hand-craft. Every piece is conceived in our
          Jaipur studio, embroidered by karigars who have carried their craft for generations,
          and cut to the way you actually live — at the wedding, the reception, and every evening
          in between.
        </p>
      </section>

      <section className="story">
        <div className="srow">
          <ImageSlot label="The studio" />
          <div className="stext">
            <div className="num">01</div>
            <span className="eyebrow">The Beginning</span>
            <h2>From a single length of silk.</h2>
            <p>
              Founded in 2026, the house began in Bapu Nagar with a small circle of master
              embroiderers. The first collection, Rang Mehfil, set the pattern the house still
              follows: hand embroidery, jewel colour, and a name in the mother tongue.
            </p>
          </div>
        </div>
        <div className="srow flip">
          <div className="stext">
            <div className="num">02</div>
            <span className="eyebrow">The Craft</span>
            <h2>By hand, at its own pace.</h2>
            <p>
              Zardozi, mukaish, chikankari, mirror — our karigars map each motif and set every
              sequin individually. Nothing is rushed; nothing is machine-finished where a hand can
              do it better.
            </p>
          </div>
          <ImageSlot label="Embroidery detail" />
        </div>
        <div className="srow">
          <ImageSlot label="Made to order fitting" />
          <div className="stext">
            <div className="num">03</div>
            <span className="eyebrow">Made to Order</span>
            <h2>Cut to your measure.</h2>
            <p>
              We make to order, never to waste. Each commission begins with a consultation —
              virtual or in our studio — so the finished piece is yours alone, in fit and in
              feeling.
            </p>
          </div>
        </div>
      </section>

      <section className="values">
        <div className="vh">
          <span className="eyebrow">What We Hold To</span>
          <h2>The house values.</h2>
        </div>
        <div className="vgrid">
          <div className="vcell">
            <div className="vn">I.</div>
            <h3>Hand over Machine</h3>
            <p>Every embellishment is placed by a karigar's hand. Slow craft, honestly made.</p>
          </div>
          <div className="vcell">
            <div className="vn">II.</div>
            <h3>Made, not Stocked</h3>
            <p>We craft on commission — reducing waste and making each piece personal.</p>
          </div>
          <div className="vcell">
            <div className="vn">III.</div>
            <h3>Heritage, Forward</h3>
            <p>Archival techniques, contemporary silhouettes. Tradition you can actually wear.</p>
          </div>
        </div>
      </section>

      {/* Drift-proof facts only — no invented counts (audit §03). */}
      <section className="stats">
        <div className="stat">
          <div className="big">One</div>
          <div className="lbl">Workroom — Bapu Nagar, Jaipur</div>
        </div>
        <div className="stat">
          <div className="big">By hand</div>
          <div className="lbl">Zardozi · Mukaish · Chikankari · Mirror</div>
        </div>
        <div className="stat">
          <div className="big">100%</div>
          <div className="lbl">Made to Order</div>
        </div>
      </section>

      <section className="house-cta">
        <h2>Begin your commission</h2>
        <p>Book a complimentary consultation with our atelier — virtual or in studio.</p>
        <Link
          className="btn btn-solid"
          style={{ background: 'var(--ink)', color: 'var(--paper)', borderRadius: 999 }}
          to="/contact"
        >
          Book an Appointment
        </Link>
      </section>
      <Reveal />
      <Ambient />
    </Shop>
  );
}
