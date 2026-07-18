import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Shop from '../components/Shop';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import { track } from '../lib/analytics';
import '../styles/contact.css';

export default function Contact() {
  const [tab, setTab] = useState<'appointment' | 'enquiry'>('appointment');
  const [sent, setSent] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    track('contact_submit', { props: { tab } });
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
            Book a complimentary consultation, ask about a commission, or simply say hello. Our
            atelier responds within 48 hours.
          </p>
          <div className="ct-block">
            <h4>The Studio</h4>
            <p>
              Apt 4, Verdant House
              <br />
              Altamount Road, Mumbai 400026
              <br />
              By appointment only
            </p>
          </div>
          <div className="ct-block">
            <h4>Write to Us</h4>
            <p>
              <a href="#">care@tanviagnihotry.com</a>
              <br />
              <a href="#">+91 90000 00000</a>
            </p>
          </div>
          <div className="ct-block">
            <h4>Studio Hours</h4>
            <p>Monday – Saturday · 11am – 7pm IST</p>
          </div>
          <div className="ct-block">
            <h4>Follow</h4>
            <p>
              <a href="#">Instagram</a> &nbsp; <a href="#">Pinterest</a> &nbsp;{' '}
              <a href="#">WhatsApp</a>
            </p>
          </div>
        </aside>

        <section className="ct-form">
          <div className="fh">
            <h2>Get in touch</h2>
            <p>Tell us what you're looking for and we'll be in touch.</p>
          </div>
          <div className="ct-tabs">
            <button
              className={`ct-tab${tab === 'appointment' ? ' on' : ''}`}
              onClick={() => setTab('appointment')}
            >
              Book an Appointment
            </button>
            <button
              className={`ct-tab${tab === 'enquiry' ? ' on' : ''}`}
              onClick={() => setTab('enquiry')}
            >
              General Enquiry
            </button>
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
              {tab === 'appointment' && (
                <div className="grid2" id="apptFields">
                  <div className="field">
                    <label className="lab" htmlFor="ct-date">
                      Preferred Date
                    </label>
                    <input id="ct-date" className="inp" type="text" placeholder="DD / MM / YYYY" />
                  </div>
                  <div className="field">
                    <label className="lab" htmlFor="ct-type">
                      Consultation Type
                    </label>
                    <select id="ct-type" className="inp">
                      <option>Virtual consultation</option>
                      <option>In-studio (Mumbai)</option>
                      <option>Bridal commission</option>
                    </select>
                  </div>
                </div>
              )}
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
