import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Shop from '../components/Shop';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import { track } from '../lib/analytics';
import '../styles/contact.css';

// Brand marks from simple-icons (filled, single path)
const INSTAGRAM_PATH =
  'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077';
const PINTEREST_PATH =
  'M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z';
const WHATSAPP_PATH =
  'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';

function BrandIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      style={{ verticalAlign: '-0.14em', marginRight: '0.35em' }}
    >
      <path d={d} />
    </svg>
  );
}

export default function Contact() {
  const [sent, setSent] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    track('contact_submit');
    setSent(true);
  };

  return (
    <Shop page="page-contact">
      <div className="crumbs">
        <Link to="/">Home</Link>
        <span className="sep">/</span>
        <span className="here">Contact</span>
      </div>

      <main className="ct">
        <aside className="ct-aside">
          <span className="eyebrow">Client Care</span>
          <h1>We would love to dress you.</h1>
          <p>
            Ask about a commission, or simply say hello. Our atelier responds within 48 hours.
          </p>
          <div className="ct-block">
            <h4>The Studio</h4>
            <p>
              B-74, Rajendra Marg
              <br />
              Bapu Nagar, Jaipur
            </p>
          </div>
          <div className="ct-block">
            <h4>Call the Atelier</h4>
            <p>
              <a href="tel:+918118892523">+91 81188 92523</a>
            </p>
          </div>
          <div className="ct-block">
            <h4>Studio Hours</h4>
            <p>Monday – Saturday · 11am – 7pm IST</p>
          </div>
          <div className="ct-block">
            <h4>Follow</h4>
            <p>
              <a href="https://instagram.com/tanviagnihotrylabel">
                <BrandIcon d={INSTAGRAM_PATH} /> Instagram
              </a>{' '}
              &nbsp;{' '}
              <a href="#">
                <BrandIcon d={PINTEREST_PATH} /> Pinterest
              </a>{' '}
              &nbsp;{' '}
              <a href="https://wa.me/918118892523">
                <BrandIcon d={WHATSAPP_PATH} /> WhatsApp
              </a>
            </p>
          </div>
        </aside>

        <section className="ct-form">
          <div className="fh">
            <h2>Get in touch</h2>
            <p>Tell us what you're looking for and we'll be in touch.</p>
          </div>
          {!sent ? (
            <form onSubmit={onSubmit}>
              <div className="grid2">
                <div className="field">
                  <label className="lab" htmlFor="ct-first">
                    First Name
                  </label>
                  <input id="ct-first" className="inp" placeholder="First name" required />
                </div>
                <div className="field">
                  <label className="lab" htmlFor="ct-last">
                    Last Name
                  </label>
                  <input id="ct-last" className="inp" placeholder="Last name" required />
                </div>
              </div>
              <div className="grid2">
                <div className="field">
                  <label className="lab" htmlFor="ct-email">
                    Email
                  </label>
                  <input
                    id="ct-email"
                    className="inp"
                    type="email"
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div className="field">
                  <label className="lab" htmlFor="ct-phone">
                    Phone
                  </label>
                  <input id="ct-phone" className="inp" type="tel" placeholder="+91 90000 00000" />
                </div>
              </div>
              <div className="field">
                <label className="lab" htmlFor="ct-more">
                  Tell us more
                </label>
                <textarea
                  id="ct-more"
                  className="inp"
                  placeholder="The occasion, the piece you have in mind, timelines…"
                ></textarea>
              </div>
              <label className="check" style={{ margin: '0.4rem 0 1.2rem' }}>
                <input type="checkbox" defaultChecked /> Keep me updated on new collections
              </label>
              <button className="btn-buy submit" type="submit">
                Send Request
              </button>
            </form>
          ) : (
            <div className="ok show" id="ctOk">
              <div className="s">✓</div>
              <h3>Thank you — request received.</h3>
              <p>A member of our atelier will be in touch within 48 hours.</p>
            </div>
          )}
        </section>
      </main>
      <Reveal />
      <Ambient />
    </Shop>
  );
}
