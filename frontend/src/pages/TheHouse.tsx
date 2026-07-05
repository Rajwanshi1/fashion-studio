import { Link } from 'react-router-dom';
import Shop from '../components/Shop';
import ImageSlot from '../components/ImageSlot';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/house.css';

export default function TheHouse() {
  return (
    <Shop page="page-house">
      <header className="house-hero">
        <ImageSlot label="Atelier / founder portrait — full bleed" />
        <div className="ht">
          <span className="eyebrow">The House of Tanvi Agnihotry</span>
          <h1>
            Heritage,
            <br />
            made to move.
          </h1>
        </div>
      </header>

      <section className="manifesto">
        <p className="lede">
          We began with a simple conviction — that an Indian woman should never have to choose
          between the weight of tradition and the ease of the present.
        </p>
        <p>
          Tanvi Agnihotry is an indo-western couture house built on hand-craft. Every piece is
          conceived in our studio, embroidered by karigars who have carried their craft for
          generations, and cut to the way you actually live — at the wedding, the reception, and
          every evening in between.
        </p>
      </section>

      <section className="story">
        <div className="srow">
          <ImageSlot label="The studio" />
          <div className="stext">
            <div className="num">01</div>
            <span className="eyebrow">The Beginning</span>
            <h2>From a single length of tissue.</h2>
            <p>
              Founded in 2026, the house grew from a studio in Mumbai and a small circle of master
              embroiderers. We chose green as our signature — the colour of renewal — and built
              every collection around it.
            </p>
          </div>
        </div>
        <div className="srow flip">
          <div className="stext">
            <div className="num">02</div>
            <span className="eyebrow">The Craft</span>
            <h2>Three hundred hours, by hand.</h2>
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

      <section className="stats">
        <div className="stat">
          <div className="big">40+</div>
          <div className="lbl">Master Karigars</div>
        </div>
        <div className="stat">
          <div className="big">300 hrs</div>
          <div className="lbl">Avg. per Piece</div>
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
