import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ImageSlot from '../components/ImageSlot';

const getImg = () => screen.getByRole('img') as HTMLImageElement;

describe('ImageSlot', () => {
  it('lazy-loads with async decoding by default, no fetch priority', () => {
    render(<ImageSlot src="/img/a.jpg" alt="A" />);
    const img = getImg();
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).not.toHaveAttribute('fetchpriority');
  });

  it('eager mode loads eagerly at high fetch priority (hero / first PDP slide)', () => {
    render(<ImageSlot src="/img/a.jpg" alt="A" eager />);
    const img = getImg();
    expect(img).toHaveAttribute('loading', 'eager');
    // React 18: lowercase attribute passes through to the DOM untouched.
    expect(img).toHaveAttribute('fetchpriority', 'high');
  });

  it('emits srcset + sizes only when the master width is known', () => {
    render(<ImageSlot src="/img/a.jpg" alt="A" width={2000} height={2500} sizes="(max-width: 560px) 50vw, 25vw" />);
    const img = getImg();
    expect(img).toHaveAttribute(
      'srcset',
      '/img/a_w320.jpg 320w, /img/a_w640.jpg 640w, /img/a_w1080.jpg 1080w, /img/a_w1600.jpg 1600w, /img/a.jpg 2000w',
    );
    expect(img).toHaveAttribute('sizes', '(max-width: 560px) 50vw, 25vw');
    // Intrinsic dims reserve layout before the pixels arrive.
    expect(img).toHaveAttribute('width', '2000');
    expect(img).toHaveAttribute('height', '2500');
  });

  it('only offers rendition rungs BELOW the master width', () => {
    render(<ImageSlot src="/img/a.jpg" alt="A" width={1080} height={1350} sizes="72px" />);
    expect(getImg()).toHaveAttribute('srcset', '/img/a_w320.jpg 320w, /img/a_w640.jpg 640w, /img/a.jpg 1080w');
  });

  it('emits NO srcset without a width — pre-renditions uploads have no candidates', () => {
    render(<ImageSlot src="/img/a.jpg" alt="A" sizes="72px" />);
    const img = getImg();
    expect(img).not.toHaveAttribute('srcset');
    // sizes without srcset is meaningless — suppressed with it.
    expect(img).not.toHaveAttribute('sizes');
  });

  it('emits NO srcset for a non-.jpg source (CMS/blob URLs have no rendition siblings)', () => {
    render(<ImageSlot src="blob:preview-1" alt="A" width={2000} sizes="100vw" />);
    const img = getImg();
    expect(img).not.toHaveAttribute('srcset');
    expect(img).toHaveAttribute('width', '2000');
  });

  it('paints the placeholder hex behind the photo and eases in on load', () => {
    render(<ImageSlot src="/img/a.jpg" alt="A" placeholderHex="#9cb6aa" />);
    const img = getImg();
    expect(img.style.backgroundColor).toMatch(/rgb\(156,\s*182,\s*170\)|#9cb6aa/);
    expect(img.className).not.toContain('img-in');
    fireEvent.load(img);
    expect(img.className).toContain('img-in');
  });

  it('keeps the src-less placeholder behaviour (celadon slot + caption)', () => {
    render(<ImageSlot src={null} label="Drop campaign image" />);
    const slot = screen.getByRole('img', { name: 'Drop campaign image' });
    expect(slot.tagName).toBe('DIV');
    expect(slot.className).toContain('img-slot');
  });
});
