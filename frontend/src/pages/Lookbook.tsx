import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import Shop from '../components/Shop';
import ImageSlot from '../components/ImageSlot';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import { useSiteContent } from '../lib/content';
import type { Look } from '../lib/content';
import '../styles/lookbook.css';

/** The caption beside a featured look. The layout is fixed — only looks 01 and
 *  04 carry one, and the section decides which side of the image it sits on. */
function Caption({ look }: { look: Look }) {
  return (
    <div className="caption">
      <span className="look-no">{look.lookNo}</span>
      <h3>{look.title}</h3>
      <p>{look.copy}</p>
      <Link className="shop-look" to={look.ctaHref}>
        Shop the Look →
      </Link>
    </div>
  );
}

export default function Lookbook() {
  const { lookbookCover, lookbook } = useSiteContent();
  // Fixed slots: the page's shape never changes, only the content flowing in.
  const looks = lookbook.looks;

  return (
    <Shop page="page-lookbook">
      <header className="lb-cover">
        <ImageSlot src={lookbookCover.imageUrl} label="Lookbook cover — full bleed editorial" />
        <div className="cc">
          <div className="masthead">{lookbookCover.masthead}</div>
          <div className="sub">
            {lookbookCover.subItems.map((item, i) => (
              <Fragment key={i}>
                {i > 0 && <span>·</span>}
                <span>{item}</span>
              </Fragment>
            ))}
          </div>
        </div>
        <div className="scroll">Scroll to enter ↓</div>
      </header>

      <main className="lb">
        <section className="spread text-left">
          <Caption look={looks[0]} />
          <ImageSlot className="ar54" src={looks[0].imageUrl} label="Look 01 — wide" />
        </section>

        <section className="spread duo">
          <ImageSlot className="ar34" src={looks[1].imageUrl} label="Look 02" />
          <ImageSlot className="ar34" src={looks[2].imageUrl} label="Look 03" />
        </section>

        <div className="pull">
          <blockquote>{lookbook.quote}</blockquote>
          <cite>{lookbook.quoteCite}</cite>
        </div>

        <section className="spread offset">
          <ImageSlot className="ar45" src={looks[3].imageUrl} label="Look 04 — large" />
          <Caption look={looks[3]} />
        </section>

        <section className="spread duo">
          <ImageSlot className="ar34" src={looks[4].imageUrl} label="Look 05" />
          <ImageSlot className="ar34" src={looks[5].imageUrl} label="Look 06" />
        </section>

        <section className="spread">
          <ImageSlot className="ar54" src={looks[6].imageUrl} label="Look 07 — full bleed" />
        </section>
      </main>
      <Reveal />
      <Ambient />
    </Shop>
  );
}
