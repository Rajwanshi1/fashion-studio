import { Link } from 'react-router-dom';
import Shop from '../components/Shop';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/care.css';
import { usePageTitle } from '../lib/usePageTitle';

export default function ClientCare() {
  usePageTitle('Client Care');
  return (
    <Shop page="page-care">
      <div className="crumbs">
        <Link to="/">Home</Link>
        <span className="sep">/</span>
        <span className="here">Client Care</span>
      </div>

      <div className="page-hero">
        <span className="eyebrow">We're Here to Help</span>
        <h1>Client Care</h1>
        <p>
          Everything about ordering, made-to-order timelines, shipping, and care. Can't find an
          answer? Our atelier is a message away.
        </p>
      </div>

      <main className="cc-wrap">
        <div className="cc-quick">
          <a href="#orders">
            <div className="t">Orders</div>
            <div className="d">Track &amp; manage</div>
          </a>
          <a href="#shipping">
            <div className="t">Shipping</div>
            <div className="d">Worldwide</div>
          </a>
          <a href="#returns">
            <div className="t">Returns</div>
            <div className="d">Exchanges</div>
          </a>
          <Link to="/size-guide">
            <div className="t">Size &amp; Fit</div>
            <div className="d">Measure guide</div>
          </Link>
        </div>

        <section className="faq-section" id="orders">
          <h2>Made to Order</h2>
          <p className="lead">How our atelier crafts your piece.</p>
          <details className="acc" open>
            <summary>
              How does made-to-order work? <span className="ic">+</span>
            </summary>
            <div className="acc-body">
              Every piece is crafted on commission. Once you order, our team confirms your
              measurements within 48 hours, then begins hand-embroidery and tailoring. Standard
              sizes are dispatched in 4–6 weeks; made-to-measure in 6–8 weeks.
            </div>
          </details>
          <details className="acc">
            <summary>
              Can I order a custom size or colour? <span className="ic">+</span>
            </summary>
            <div className="acc-body">
              Yes. Select "Made to Measure" on any product, or book a consultation. Many
              silhouettes can be crafted in alternate colourways from our palette — speak with a
              stylist.
            </div>
          </details>
          <details className="acc">
            <summary>
              Can I change or cancel my order? <span className="ic">+</span>
            </summary>
            <div className="acc-body">
              Changes are possible within 24 hours of placing your order, before craft begins.
              Once embroidery has started, an order cannot be cancelled. Made-to-measure pieces
              are final.
            </div>
          </details>
        </section>

        <section className="faq-section" id="shipping">
          <h2>Shipping</h2>
          <p className="lead">Insured and tracked, worldwide.</p>
          <details className="acc">
            <summary>
              Where do you ship? <span className="ic">+</span>
            </summary>
            <div className="acc-body">
              We ship worldwide with complimentary insured delivery. Domestic (India) orders are
              tracked door-to-door; international orders ship via premium couriers.
            </div>
          </details>
          <details className="acc">
            <summary>
              How long does delivery take? <span className="ic">+</span>
            </summary>
            <div className="acc-body">
              Delivery follows the craft window: 4–6 weeks for standard, 6–8 for made-to-measure.
              You'll receive tracking the moment your piece is dispatched.
            </div>
          </details>
          <details className="acc">
            <summary>
              Are duties and taxes included? <span className="ic">+</span>
            </summary>
            <div className="acc-body">
              Indian orders are inclusive of all taxes. International duties, where applicable,
              are calculated at checkout or billed on delivery depending on destination.
            </div>
          </details>
        </section>

        <section className="faq-section" id="returns">
          <h2>Returns &amp; Exchanges</h2>
          <p className="lead">Because each piece is made for you.</p>
          <details className="acc">
            <summary>
              What is your returns policy? <span className="ic">+</span>
            </summary>
            <div className="acc-body">
              As pieces are made to order, we offer exchanges or store credit rather than refunds,
              within 7 days of delivery, on unworn pieces with tags intact. Made-to-measure pieces
              are final sale.
            </div>
          </details>
          <details className="acc">
            <summary>
              The fit isn't quite right — what now? <span className="ic">+</span>
            </summary>
            <div className="acc-body">
              Reach out within 7 days and our atelier will arrange a complimentary alteration to
              perfect the fit.
            </div>
          </details>
        </section>

        <section className="faq-section" id="care">
          <h2>Garment Care</h2>
          <p className="lead">Keeping hand-craft beautiful.</p>
          <details className="acc">
            <summary>
              How do I care for my piece? <span className="ic">+</span>
            </summary>
            <div className="acc-body">
              Dry clean only, with a specialist familiar with hand-embroidery. Store flat or
              padded, away from direct light. Handle sequins and zardozi gently.
            </div>
          </details>
          <details className="acc">
            <summary>
              What payment methods do you accept? <span className="ic">+</span>
            </summary>
            <div className="acc-body">
              All major cards, UPI, and wallets. Cash on delivery is available on standard sizes
              within India.
            </div>
          </details>
        </section>
      </main>

      <section className="cc-help">
        <span className="eyebrow">Still Have a Question?</span>
        <h2>Our atelier is a message away.</h2>
        <Link className="btn btn-line" to="/contact">
          Contact Client Care →
        </Link>
      </section>
      <Reveal />
      <Ambient />
    </Shop>
  );
}
