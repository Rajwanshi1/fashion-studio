import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';
import { uploadProductImage } from '../lib/uploads';

// prepareImage needs canvas/createImageBitmap, which jsdom lacks — the upload
// pipeline itself is covered by uploads.test.ts.
vi.mock('../lib/uploads', () => ({
  uploadProductImage: vi.fn(async () => ({
    publicUrl: 'https://fashion-uploads.s3.ap-south-1.amazonaws.com/products/2026/08/hero.jpg',
    pose: null,
    color: null,
    colorHex: null,
  })),
}));

const UPLOADED = 'https://fashion-uploads.s3.ap-south-1.amazonaws.com/products/2026/08/hero.jpg';
type UploadResult = Awaited<ReturnType<typeof uploadProductImage>>;

const SECTION_KEYS = [
  'hero',
  'featured',
  'marquee',
  'trust',
  'lookbookCover',
  'lookbook',
  'ticker',
  'footer',
];

/** GET /api/content with the given stored sections; every write answers 204. */
function stubContent(sections: Record<string, unknown>) {
  return mockFetch((url, init) => {
    if (url.endsWith('/api/content')) return { json: { sections } };
    if (url.includes('/api/admin/content/') && init?.method !== 'GET') {
      return { status: 204, json: null };
    }
    return undefined;
  });
}

describe('site section editor', () => {
  it('prefills the built-in defaults and PUTs the whole section', async () => {
    seedAdminAuth();
    const { calls } = stubContent({});

    renderApp('/site/hero');

    const title = await screen.findByLabelText('Headline');
    expect(title).toHaveValue('Tanvi Agnihotry');
    // untouched section — nothing to reset to
    expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();

    await userEvent.clear(title);
    await userEvent.type(title, 'The Verdant Season');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Live on the site')).toBeInTheDocument());

    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toMatch(/\/api\/admin\/content\/hero$/);
    // the whole section travels, not just the edited field — including the
    // focal point, which a photo-less default carries as centred 50/50
    expect(put?.body).toEqual({
      imageUrl: null,
      focusX: 50,
      focusY: 50,
      seasonLabel: 'Festive 2026',
      eyebrow: 'Hand-embroidered, made to order · Jaipur',
      title: 'The Verdant Season',
      titleItalic: 'jahan har rang ek kissa sunata hai.',
      ctaPrimary: 'Discover the Collection',
      ctaSecondary: 'Book an Appointment',
      edgeLeft: 'Made to Order — Jaipur',
      edgeRight: 'Rang Mehfil — Vol. 01',
    });

    // saved → back on the Site list
    expect(await screen.findByRole('heading', { name: 'Site' })).toBeInTheDocument();
  });

  it('shows the stored value, falling back to the default for blanks', async () => {
    seedAdminAuth();
    stubContent({ hero: { title: 'Custom headline', eyebrow: '' } });

    renderApp('/site/hero');

    expect(await screen.findByLabelText('Headline')).toHaveValue('Custom headline');
    // the storefront falls back to its default for a blank string — so does the
    // editor, which shows what the site actually renders.
    expect(screen.getByLabelText('Eyebrow')).toHaveValue(
      'Hand-embroidered, made to order · Jaipur',
    );
    // and says so, once, so clearing a field is not a silent no-op
    expect(screen.getByText('Leaving a field blank restores the built-in copy.')).toBeInTheDocument();
  });

  it('adds, reorders and drops blank rows in a list section', async () => {
    seedAdminAuth();
    const { calls } = stubContent({});

    renderApp('/site/marquee');

    expect(await screen.findByLabelText('Line 1')).toHaveValue('Made to Order');

    await userEvent.click(screen.getByRole('button', { name: 'Move line 2 up' }));
    expect(screen.getByLabelText('Line 1')).toHaveValue('— hand embroidered —');
    expect(screen.getByLabelText('Line 2')).toHaveValue('Made to Order');

    await userEvent.click(screen.getByRole('button', { name: 'Remove line 4' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }));
    // a row left blank never reaches the server (the schema rejects empties)
    await userEvent.type(screen.getByLabelText('Line 4'), '   ');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toMatch(/\/api\/admin\/content\/marquee$/);
    expect(put?.body).toEqual({
      items: ['— hand embroidered —', 'Made to Order', 'Rang Mehfil'],
    });
  });

  it('stops offering new lines at the eight-line cap', async () => {
    seedAdminAuth();
    stubContent({});

    renderApp('/site/marquee');
    await screen.findByLabelText('Line 1');

    for (let i = 0; i < 4; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Add line' }));
    }

    expect(screen.getByLabelText('Line 8')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add line' })).not.toBeInTheDocument();
  });

  it('caps the cover sub-lines at four, not the usual eight', async () => {
    seedAdminAuth();
    stubContent({});

    renderApp('/site/lookbookCover');

    expect(await screen.findByLabelText('Sub-line 1')).toHaveValue('Volume 01');
    await userEvent.click(screen.getByRole('button', { name: 'Add sub-line' }));

    expect(screen.getByLabelText('Sub-line 4')).toBeInTheDocument();
    // this list's own cap — marquee and ticker stop at eight
    expect(screen.queryByRole('button', { name: 'Add sub-line' })).not.toBeInTheDocument();
  });

  it('caps each field where its schema does', async () => {
    seedAdminAuth();
    stubContent({});

    renderApp('/site/featured');

    expect(await screen.findByLabelText('Title')).toHaveAttribute('maxlength', '300');
    expect(screen.getByLabelText('Copy')).toHaveAttribute('maxlength', '1000');
    // …Url / …Href fields are `url` in the schemas — 500, not `str`'s 300
    expect(screen.getByLabelText('Link target')).toHaveAttribute('maxlength', '500');
  });

  it('refuses to save a list section with nothing left in it', async () => {
    seedAdminAuth();
    const { calls } = stubContent({});

    renderApp('/site/marquee');
    await screen.findByLabelText('Line 1');

    // last row first, so the remaining labels keep their numbers
    for (let i = 4; i > 0; i -= 1) {
      await userEvent.click(screen.getByRole('button', { name: `Remove line ${i}` }));
    }
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // an empty list reads as "use the default" to the storefront — saying so
    // beats a save that looks successful and changes nothing
    expect(await screen.findByText('Marquee needs at least one line')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('uploads a picked photo into the section image', async () => {
    seedAdminAuth();
    const { calls } = stubContent({});

    renderApp('/site/hero');
    await screen.findByLabelText('Headline');

    const file = new File([new Uint8Array([1])], 'hero.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Photo file'), file);

    // no product to name it after — a plain uuid presign
    expect(uploadProductImage).toHaveBeenCalledWith(file);
    expect(await screen.findByAltText('Photo')).toHaveAttribute('src', UPLOADED);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const put = calls.find((c) => c.method === 'PUT');
    expect((put?.body as { imageUrl: string }).imageUrl).toBe(UPLOADED);
  });

  it('holds Save until an in-flight upload lands', async () => {
    seedAdminAuth();
    const { calls } = stubContent({ hero: { imageUrl: 'https://cdn.example/old.jpg' } });
    let land: (result: UploadResult) => void = () => {};
    vi.mocked(uploadProductImage).mockImplementationOnce(
      () => new Promise((resolve) => (land = resolve)),
    );

    renderApp('/site/hero');
    await screen.findByLabelText('Headline');

    const file = new File([new Uint8Array([1])], 'hero.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Photo file'), file);

    // picker → save bar is the natural phone gesture; saving now would PUT the
    // pre-upload URL and lose the photo
    const save = screen.getByRole('button', { name: 'Uploading photo…' });
    expect(save).toBeDisabled();
    await userEvent.click(save);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);

    await act(async () => {
      land({ publicUrl: UPLOADED, pose: null, color: null, colorHex: null });
    });

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const put = calls.find((c) => c.method === 'PUT');
    expect((put?.body as { imageUrl: string }).imageUrl).toBe(UPLOADED);
  });

  it('keeps the old photo and toasts when an upload fails', async () => {
    seedAdminAuth();
    stubContent({ hero: { imageUrl: 'https://cdn.example/old.jpg' } });
    vi.mocked(uploadProductImage).mockRejectedValueOnce(new Error('Photo upload failed (503)'));

    renderApp('/site/hero');
    await screen.findByAltText('Photo');

    const file = new File([new Uint8Array([1])], 'hero.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Photo file'), file);

    expect(await screen.findByText('Photo upload failed (503)')).toBeInTheDocument();
    expect(screen.getByAltText('Photo')).toHaveAttribute('src', 'https://cdn.example/old.jpg');
    // the bar is live again — a failed upload must not wedge the page
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('clears the section image with Remove photo', async () => {
    seedAdminAuth();
    const { calls } = stubContent({ hero: { imageUrl: 'https://cdn.example/old.jpg' } });

    renderApp('/site/hero');
    expect(await screen.findByAltText('Photo')).toHaveAttribute('src', 'https://cdn.example/old.jpg');

    await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(screen.queryByAltText('Photo')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const put = calls.find((c) => c.method === 'PUT');
    expect((put?.body as { imageUrl: string | null }).imageUrl).toBeNull();
  });

  it('carries a stored focal point through an unrelated save', async () => {
    seedAdminAuth();
    const { calls } = stubContent({
      hero: { imageUrl: 'https://cdn.example/h.jpg', focusX: 30, focusY: 70 },
      lookbook: { looks: [{ imageUrl: 'https://cdn.example/l.jpg', focusX: 10, focusY: 90 }] },
    });

    renderApp('/site/hero');
    const title = await screen.findByLabelText('Headline');
    await userEvent.clear(title);
    await userEvent.type(title, 'New season');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // editing the headline must not recentre the photo's saved crop
    const hero = calls.find((c) => c.method === 'PUT')?.body as { focusX: number; focusY: number };
    expect(hero.focusX).toBe(30);
    expect(hero.focusY).toBe(70);
  });

  it('keeps exactly three trust promises and saves them whole', async () => {
    seedAdminAuth();
    const { calls } = stubContent({});

    renderApp('/site/trust');

    expect(await screen.findByLabelText('Promise 1 title')).toHaveValue('Made to Order');
    expect(screen.getByLabelText('Promise 3 detail')).toHaveValue(
      'Insured & tracked, on the house',
    );
    expect(screen.queryByLabelText('Promise 4 title')).not.toBeInTheDocument();
    // three is the schema's exact count — no add/remove affordance
    expect(screen.queryByRole('button', { name: /^Add/ })).not.toBeInTheDocument();

    const detail = screen.getByLabelText('Promise 2 detail');
    await userEvent.clear(detail);
    await userEvent.type(detail, 'In studio, Bandra');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const items = (calls.find((c) => c.method === 'PUT')?.body as {
      items: { title: string; detail: string }[];
    }).items;
    expect(items).toHaveLength(3);
    expect(items[1]).toEqual({ title: 'Complimentary Fittings', detail: 'In studio, Bandra' });
  });

  it('saves all seven looks alongside the pull-quote', async () => {
    seedAdminAuth();
    const { calls } = stubContent({});

    renderApp('/site/lookbook');

    expect(await screen.findByLabelText('Look 1 title')).toHaveValue('Rang, unhurried.');
    expect(screen.getByLabelText('Look 7 number')).toHaveValue('Look 07');
    expect(screen.queryByLabelText('Look 8 number')).not.toBeInTheDocument();
    // looks 1 and 4 are the two the storefront prints a caption for
    expect(screen.getAllByText(/shown with caption/)).toHaveLength(2);

    const title = screen.getByLabelText('Look 2 title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Ivory hour.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const body = calls.find((c) => c.method === 'PUT')?.body as {
      looks: Record<string, unknown>[];
      quote: string;
      quoteCite: string;
    };
    expect(body.looks).toHaveLength(7);
    expect(Object.keys(body.looks[0]).sort()).toEqual(
      ['copy', 'ctaHref', 'focusX', 'focusY', 'imageUrl', 'lookNo', 'title'].sort(),
    );
    expect(body.looks[1].title).toBe('Ivory hour.');
    expect(body.quote).toBe(
      '"She does not choose between heritage and the present. She wears both, at once."',
    );
    expect(body.quoteCite).toBe('— Rang Mehfil');
  });

  it('keeps edits made while a look photo was still uploading', async () => {
    seedAdminAuth();
    const { calls } = stubContent({});
    let land: (result: UploadResult) => void = () => {};
    vi.mocked(uploadProductImage).mockImplementationOnce(
      () => new Promise((resolve) => (land = resolve)),
    );

    renderApp('/site/lookbook');
    await screen.findByLabelText('Look 1 title');

    const file = new File([new Uint8Array([1])], 'look.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Look 1 photo file'), file);

    // the boutique carries on writing while the photo goes up
    await userEvent.type(screen.getByLabelText('Look 2 caption'), 'Ivory hour, after the rain.');

    await act(async () => {
      land({ publicUrl: UPLOADED, pose: null, color: null, colorHex: null });
    });

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const looks = (
      calls.find((c) => c.method === 'PUT')?.body as { looks: Record<string, unknown>[] }
    ).looks;
    expect(looks[0].imageUrl).toBe(UPLOADED);
    // a late upload lands as a patch on current state — it must not put back
    // the looks as they stood when the picker opened
    expect(looks[1].copy).toBe('Ivory hour, after the rain.');
  });

  it('refuses to send a section too big for the edge WAF', async () => {
    seedAdminAuth();
    const bigLook = {
      imageUrl: `https://cdn.example/${'a'.repeat(400)}.jpg`,
      lookNo: 'Look 01',
      title: 'T'.repeat(300),
      copy: 'C'.repeat(1000),
      ctaHref: `/collection/${'b'.repeat(400)}`,
    };
    const { calls } = stubContent({
      lookbook: { looks: Array.from({ length: 7 }, () => bigLook) },
    });

    renderApp('/site/lookbook');
    await screen.findByLabelText('Look 1 title');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // prod's CloudFront WAF answers a >8KB body with an opaque 403 and no log
    // line, so an over-long section never leaves the browser
    expect(await screen.findByText('Section too large — shorten the copy')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('resets a customised section to its default after confirming', async () => {
    seedAdminAuth();
    const { calls } = stubContent({ hero: { title: 'Custom' } });

    renderApp('/site/hero');
    expect(await screen.findByLabelText('Headline')).toHaveValue('Custom');

    // backing out of the confirm leaves the section alone
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, reset' }));

    await waitFor(() => expect(screen.queryByDisplayValue('Custom')).not.toBeInTheDocument());
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toMatch(/\/api\/admin\/content\/hero$/);
    expect(screen.getByLabelText('Headline')).toHaveValue('Tanvi Agnihotry');
    expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();
  });

  it('toasts the server message when a save is rejected', async () => {
    seedAdminAuth();
    mockFetch((url, init) => {
      if (url.endsWith('/api/content')) return { json: { sections: {} } };
      if (url.endsWith('/api/admin/content/hero') && init?.method === 'PUT') {
        return { status: 400, json: { error: 'title: String must contain at most 300 character(s)' } };
      }
      return undefined;
    });

    renderApp('/site/hero');
    await screen.findByLabelText('Headline');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('title: String must contain at most 300 character(s)'),
    ).toBeInTheDocument();
    // still on the editor, edits intact
    expect(screen.getByRole('heading', { name: 'Hero' })).toBeInTheDocument();
  });

  it('re-renders the live preview on every keystroke, blank falling to default', async () => {
    seedAdminAuth();
    stubContent({});

    const { container } = renderApp('/site/hero');
    const title = await screen.findByLabelText('Headline');

    const preview = () => {
      const doc = (container.querySelector('iframe') as HTMLIFrameElement).contentDocument;
      return within((doc as Document).body);
    };
    expect(preview().getByText('Tanvi Agnihotry')).toBeInTheDocument();

    await userEvent.clear(title);
    await userEvent.type(title, 'A New Season');
    expect(preview().getByText('A New Season')).toBeInTheDocument();

    // cleared → the preview shows what the site would actually fall back to
    await userEvent.clear(title);
    expect(preview().getByText('Tanvi Agnihotry')).toBeInTheDocument();
  });

  it('sets the focal point from a tap on the photo and saves it', async () => {
    seedAdminAuth();
    const { calls } = stubContent({ hero: { imageUrl: 'https://cdn.example/h.jpg' } });

    renderApp('/site/hero');
    await screen.findByLabelText('Headline');

    const pick = screen.getByRole('button', { name: /^Focal point for photo/ });
    // a photo saved before focal points existed opens centred
    expect(pick).toHaveAccessibleName(/50% across, 50% down/);

    pick.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 200, right: 100, bottom: 200, x: 0, y: 0 }) as DOMRect;
    // detail: 1 = a real pointer click; keyboard-synthesized clicks carry 0
    fireEvent.click(pick, { detail: 1, clientX: 42, clientY: 33 });
    expect(
      screen.getByRole('button', { name: /17% down/ }),
    ).toHaveAccessibleName(/42% across/);

    // arrow keys nudge in 5% steps
    fireEvent.keyDown(screen.getByRole('button', { name: /^Focal point for photo/ }), {
      key: 'ArrowRight',
    });
    fireEvent.keyDown(screen.getByRole('button', { name: /^Focal point for photo/ }), {
      key: 'ArrowUp',
    });
    expect(
      screen.getByRole('button', { name: /^Focal point for photo/ }),
    ).toHaveAccessibleName(/47% across, 12% down/);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const body = calls.find((c) => c.method === 'PUT')?.body as {
      focusX: number;
      focusY: number;
    };
    expect(body.focusX).toBe(47);
    expect(body.focusY).toBe(12);
  });

  it('keeps a look-level focal tap out of the other looks', async () => {
    seedAdminAuth();
    const { calls } = stubContent({
      lookbook: {
        looks: [
          { imageUrl: 'https://cdn.example/l1.jpg' },
          { imageUrl: 'https://cdn.example/l2.jpg' },
        ],
      },
    });

    renderApp('/site/lookbook');
    await screen.findByLabelText('Look 1 title');

    const pick = screen.getByRole('button', { name: /^Focal point for look 1 photo/ });
    pick.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 }) as DOMRect;
    fireEvent.click(pick, { detail: 1, clientX: 10, clientY: 90 });

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const looks = (
      calls.find((c) => c.method === 'PUT')?.body as { looks: Record<string, unknown>[] }
    ).looks;
    expect(looks[0].focusX).toBe(10);
    expect(looks[0].focusY).toBe(90);
    // the neighbour keeps its centred default
    expect(looks[1].focusX).toBe(50);
    expect(looks[1].focusY).toBe(50);
  });

  it('ignores keyboard-activation clicks on the focal picker', async () => {
    seedAdminAuth();
    stubContent({ hero: { imageUrl: 'https://cdn.example/h.jpg', focusX: 70, focusY: 40 } });

    renderApp('/site/hero');
    await screen.findByLabelText('Headline');

    const pick = screen.getByRole('button', { name: /^Focal point for photo/ });
    pick.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 }) as DOMRect;
    // Enter/Space synthesize a click at 0,0 with detail 0 — without the guard
    // this would silently snap the saved 70/40 crop to the top-left corner
    fireEvent.click(pick, { detail: 0, clientX: 0, clientY: 0 });
    expect(pick).toHaveAccessibleName(/70% across, 40% down/);
  });

  it('holds Cancel behind a confirm while the form has unsaved edits', async () => {
    seedAdminAuth();
    const { calls } = stubContent({});

    renderApp('/site/hero');
    await screen.findByLabelText('Headline');

    // untouched form leaves freely — no dialog
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Site' })).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('link', { name: /^Edit Hero/ }));
    const title2 = await screen.findByLabelText('Headline');
    await userEvent.clear(title2);
    await userEvent.type(title2, 'Half-finished thought');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // edits present — the guard holds the navigation
    expect(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Headline')).toHaveValue('Half-finished thought');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(await screen.findByRole('heading', { name: 'Site' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('collapses and restores the live preview', async () => {
    seedAdminAuth();
    stubContent({});

    const { container } = renderApp('/site/hero');
    await screen.findByLabelText('Headline');

    expect(container.querySelector('.editor-preview-frame iframe')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Hide preview' }));
    expect(container.querySelector('.editor-preview-frame')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show preview' }));
    expect(container.querySelector('.editor-preview-frame iframe')).not.toBeNull();
  });

  it('offers no focal control before a photo exists', async () => {
    seedAdminAuth();
    stubContent({});

    renderApp('/site/hero');
    await screen.findByLabelText('Headline');

    // nothing to aim at yet — the control appears with the first photo
    expect(screen.queryByRole('button', { name: /^Focal point/ })).not.toBeInTheDocument();
  });

  it('renders an editor for every section without crashing', async () => {
    seedAdminAuth();
    stubContent({});

    for (const key of SECTION_KEYS) {
      const { unmount } = renderApp(`/site/${key}`);
      expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument();
      unmount();
    }
  });

  it('sends an unknown section key back to the site list', async () => {
    seedAdminAuth();
    stubContent({});

    renderApp('/site/nonsense');

    expect(await screen.findByRole('heading', { name: 'Site' })).toBeInTheDocument();
  });
});
