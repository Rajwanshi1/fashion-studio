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

/**
 * A look's photo. `label` is the empty-state caption — an instruction to the
 * boutique about what belongs in the slot — so once a photo exists the look's
 * own title is what a visitor's screen reader should hear instead. Looks
 * without a caption (02, 03, 05–07) fall back to the label.
 */
function LookSlot({
  look,
  label,
  className,
}: {
  look: Look;
  label: string;
  className: string;
}) {
  return (
    <ImageSlot className={className} src={look.imageUrl} label={label} alt={look.title || label} />
  );
}

export default function Lookbook() {
  const { lookbookCover, lookbook } = useSiteContent();
  // Fixed slots: the page's shape never changes, only the content flowing in.
  const looks = lookbook.looks;

  return (
    <Shop page="page-lookbook">
      <header className="lb-cover">
        <ImageSlot
          src={lookbookCover.imageUrl}
          label="Lookbook cover — full bleed editorial"
          alt={lookbookCover.masthead}
        />
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
          <LookSlot className="ar54" look={looks[0]} label="Look 01 — wide" />
        </section>

        <section className="spread duo">
          <LookSlot className="ar34" look={looks[1]} label="Look 02" />
          <LookSlot className="ar34" look={looks[2]} label="Look 03" />
        </section>

        <div className="pull">
          <blockquote>{lookbook.quote}</blockquote>
          <cite>{lookbook.quoteCite}</cite>
        </div>

        <section className="spread offset">
          <LookSlot className="ar45" look={looks[3]} label="Look 04 — large" />
          <Caption look={looks[3]} />
        </section>

        <section className="spread duo">
          <LookSlot className="ar34" look={looks[4]} label="Look 05" />
          <LookSlot className="ar34" look={looks[5]} label="Look 06" />
        </section>

        <section className="spread">
          <LookSlot className="ar54" look={looks[6]} label="Look 07 — full bleed" />
        </section>
      </main>
      <Reveal />
      <Ambient />
    </Shop>
  );
}
