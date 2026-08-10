import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeOrder, mockFetch, renderApp, seedAdminAuth } from '../test/utils';

vi.mock('../lib/image', () => ({
  prepareImage: async () => ({ blob: new Blob(['photo']), contentType: 'image/jpeg' }),
}));

const BILL_DRAFT = {
  bill: { bill_number: 'CM-101', bill_date: '2026-07-20', bill_type: 'cash_memo', channel_guess: 'instagram' },
  customer: {
    name: 'Meera Kapoor',
    phone: '98200 11223',
    email: null,
    address: '12 Marine Drive',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: null,
  },
  items: [{ description: 'Sage lehenga bridal', quantity: 1, unit_price_rupees: 45000, line_total_rupees: 45000 }],
  totals: {
    subtotal_rupees: 45000,
    gst_rupees: null,
    total_rupees: 45000,
    advance_rupees: 20000,
    balance_rupees: 25000,
    advance_mode: 'cash',
  },
  delivery: { due_date: '2026-08-15' },
  confidence_notes: 'Phone digits unclear — verify against the photo',
};

/** Stubs fetch for the wizard: match, presign (doc-1, doc-2, …), raw PUT, parse, create. */
function mockWizardFetch(
  opts: {
    parse?: (documentId: string) => { status?: number; json: unknown };
    /** Fail the first N raw PUTs with a 500 — exercises the tile Retry path. */
    putFailures?: number;
  } = {},
) {
  let presigned = 0;
  let putsFailed = 0;
  return mockFetch((url, init) => {
    if (url.includes('/api/admin/customers/match')) return { json: { candidates: [] } };
    if (url.endsWith('/api/admin/uploads/presign')) {
      presigned += 1;
      return {
        status: 201,
        json: {
          documentId: `doc-${presigned}`,
          uploadUrl: `https://uploads.test/photo-${presigned}`,
          headers: { 'Content-Type': 'image/jpeg' },
        },
      };
    }
    if (url.startsWith('https://uploads.test/')) {
      if (opts.putFailures && putsFailed < opts.putFailures) {
        putsFailed += 1;
        return { status: 500, json: { error: 'upload broke' } };
      }
      return { json: {} }; // the raw PUT
    }
    const parseMatch = /\/api\/admin\/documents\/([^/]+)\/parse$/.exec(url);
    if (parseMatch) {
      if (opts.parse) return opts.parse(parseMatch[1]);
      return { json: BILL_DRAFT };
    }
    if (url.endsWith('/api/admin/orders') && init?.method === 'POST') {
      return { status: 201, json: makeOrder({ orderNumber: 'TA-2026-04903' }) };
    }
    if (url.endsWith('/api/admin/orders/o1/invoice/send') && init?.method === 'POST') {
      return {
        json: makeOrder({ orderNumber: 'TA-2026-04903', invoiceSentAt: '2026-08-10T10:00:00.000Z' }),
      };
    }
    if (url.endsWith('/api/admin/orders')) return { json: [] };
    return undefined;
  });
}

async function uploadBill() {
  fireEvent.change(screen.getByLabelText('Bill photo file'), {
    target: { files: [new File(['x'], 'bill.jpg', { type: 'image/jpeg' })] },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Parse bill' })).toBeEnabled());
}

describe('BillIntake', () => {
  beforeEach(() => {
    seedAdminAuth();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:mock-preview') }));
  });

  it('renders the capture step with camera + gallery affordances and a manual escape hatch', async () => {
    mockWizardFetch();
    renderApp('/intake');

    expect(await screen.findByRole('heading', { name: 'Scan Bill' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take bill photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose bill from gallery' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add measurement page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose measurement pages from gallery' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Parse bill' })).toBeDisabled(); // no bill yet
    expect(screen.getByRole('button', { name: 'Enter manually instead' })).toBeInTheDocument();
  });

  it('manual skip lands on a blank review form', async () => {
    mockWizardFetch();
    renderApp('/intake');
    await screen.findByRole('heading', { name: 'Scan Bill' });

    await userEvent.click(screen.getByRole('button', { name: 'Enter manually instead' }));

    expect(await screen.findByRole('button', { name: 'Record Order' })).toBeInTheDocument();
    expect(screen.getByLabelText('First Name')).toHaveValue('');
    expect(screen.getByLabelText('Bill Total (₹ rupees)')).toHaveValue(null);
  });

  it('maps the parsed bill draft into the review form', async () => {
    mockWizardFetch();
    renderApp('/intake');
    await screen.findByRole('heading', { name: 'Scan Bill' });

    await uploadBill();
    await userEvent.click(screen.getByRole('button', { name: 'Parse bill' }));

    expect(await screen.findByRole('button', { name: 'Record Order' })).toBeInTheDocument();
    expect(screen.getByLabelText('First Name')).toHaveValue('Meera');
    expect(screen.getByLabelText('Last Name')).toHaveValue('Kapoor');
    expect(screen.getByLabelText('Phone')).toHaveValue('98200 11223');
    expect(screen.getByLabelText('Address (optional)')).toHaveValue('12 Marine Drive');
    expect(screen.getByLabelText('State (optional)')).toHaveValue('Maharashtra');
    expect(screen.getByLabelText('Description')).toHaveValue('Sage lehenga bridal');
    expect(screen.getByLabelText('Bill Total (₹ rupees)')).toHaveValue(45000);
    expect(screen.getByLabelText('Advance (₹ rupees)')).toHaveValue(20000);
    expect(screen.getByLabelText('Delivery Due Date')).toHaveValue('2026-08-15');
    // confidence notes surface as the gold banner
    expect(screen.getByText(/Phone digits unclear/)).toBeInTheDocument();
    // photos peek is available against the uploaded bill
    expect(screen.getByRole('button', { name: 'View photos (1)' })).toBeInTheDocument();
  });

  it('a 503 parse offers an explicit manual path, keeping the photos attached', async () => {
    const { calls } = mockWizardFetch({
      parse: () => ({ status: 503, json: { error: 'Document parsing is not configured' } }),
    });
    renderApp('/intake');
    await screen.findByRole('heading', { name: 'Scan Bill' });

    await uploadBill();
    await userEvent.click(screen.getByRole('button', { name: 'Parse bill' }));

    // no silent blank form — the failure panel offers retry or manual entry
    await userEvent.click(await screen.findByRole('button', { name: 'Continue manually' }));

    expect(await screen.findByRole('button', { name: 'Record Order' })).toBeInTheDocument();
    expect(screen.getByLabelText('First Name')).toHaveValue(''); // nothing prefilled

    // manual completion still records the order WITH the uploaded document
    await userEvent.type(screen.getByLabelText('First Name'), 'Rhea');
    await userEvent.type(screen.getByLabelText('Phone'), '98200 11223');
    // A GST invoice now needs a bill number — this bill has none, so Cash Memo.
    await userEvent.click(screen.getByRole('button', { name: 'Cash Memo' }));
    await userEvent.type(screen.getByLabelText('Description'), 'Sage stole');
    await userEvent.type(screen.getByLabelText('Unit ₹'), '18000');
    await userEvent.type(screen.getByLabelText('Bill Total (₹ rupees)'), '18000');
    await userEvent.click(screen.getByRole('button', { name: 'Record Order' }));

    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/admin/orders'));
    expect(post?.body).toMatchObject({ documentIds: ['doc-1'], total: 1800000 });

    // wizard done screen instead of the orders redirect
    expect(await screen.findByRole('heading', { name: 'TA-2026-04903' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open order' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan next bill' })).toBeInTheDocument();
  });

  it('done card offers the invoice PDF and WhatsApp send', async () => {
    mockWizardFetch();
    renderApp('/intake');
    await screen.findByRole('heading', { name: 'Scan Bill' });

    await userEvent.click(screen.getByRole('button', { name: 'Enter manually instead' }));
    await screen.findByRole('button', { name: 'Record Order' });
    await userEvent.type(screen.getByLabelText('First Name'), 'Rhea');
    await userEvent.type(screen.getByLabelText('Phone'), '98200 11223');
    await userEvent.click(screen.getByRole('button', { name: 'Cash Memo' }));
    await userEvent.type(screen.getByLabelText('Description'), 'Sage stole');
    await userEvent.type(screen.getByLabelText('Unit ₹'), '18000');
    await userEvent.type(screen.getByLabelText('Bill Total (₹ rupees)'), '18000');
    await userEvent.click(screen.getByRole('button', { name: 'Record Order' }));

    await screen.findByRole('heading', { name: 'TA-2026-04903' });
    expect(screen.getByRole('button', { name: 'Invoice PDF' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Send invoice on WhatsApp' }));
    expect(await screen.findByRole('button', { name: 'Re-send invoice on WhatsApp' })).toBeInTheDocument();
    expect(screen.getByText(/Invoice sent/, { selector: 'p' })).toBeInTheDocument();
  });

  it('a failed parse offers Try again and succeeds on the second attempt', async () => {
    let parses = 0;
    mockWizardFetch({
      parse: () => {
        parses += 1;
        return parses === 1 ? { status: 503, json: { error: 'unavailable' } } : { json: BILL_DRAFT };
      },
    });
    renderApp('/intake');
    await screen.findByRole('heading', { name: 'Scan Bill' });

    await uploadBill();
    await userEvent.click(screen.getByRole('button', { name: 'Parse bill' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: 'Record Order' })).toBeInTheDocument();
    expect(screen.getByLabelText('First Name')).toHaveValue('Meera');
  });

  it('a failed upload shows Retry on the photo tile and recovers', async () => {
    mockWizardFetch({ putFailures: 1 });
    renderApp('/intake');
    await screen.findByRole('heading', { name: 'Scan Bill' });

    fireEvent.change(screen.getByLabelText('Bill photo file'), {
      target: { files: [new File(['x'], 'bill.jpg', { type: 'image/jpeg' })] },
    });

    expect(await screen.findByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Parse bill' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Parse bill' })).toBeEnabled());
  });

  it('surfaces measurement pages that could not be read on the review screen', async () => {
    mockWizardFetch({
      parse: (documentId) =>
        documentId === 'doc-1' ? { json: BILL_DRAFT } : { status: 503, json: { error: 'unavailable' } },
    });
    renderApp('/intake');
    await screen.findByRole('heading', { name: 'Scan Bill' });

    await uploadBill();
    fireEvent.change(screen.getByLabelText('Measurement page file'), {
      target: { files: [new File(['m'], 'page.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Parse bill' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Parse bill' }));

    expect(await screen.findByRole('button', { name: 'Record Order' })).toBeInTheDocument();
    expect(screen.getByText(/One measurement page/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View photos (2)' })).toBeInTheDocument();
  });

  it('measurement sets: add/remove rows and sets, POSTed as measurementSets', async () => {
    const { calls } = mockWizardFetch();
    renderApp('/intake');
    await screen.findByRole('heading', { name: 'Scan Bill' });
    await userEvent.click(screen.getByRole('button', { name: 'Enter manually instead' }));
    await screen.findByRole('button', { name: 'Record Order' });

    await userEvent.click(screen.getByRole('button', { name: '+ Add Measurement Set' }));
    expect(screen.getByLabelText('Set Label')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Set Label'), 'Blouse');
    await userEvent.type(screen.getByLabelText('Measurement 1 name'), 'SH');
    await userEvent.type(screen.getByLabelText('Measurement 1 value'), '15 in');

    // add a second row, then remove it again
    await userEvent.click(screen.getByRole('button', { name: '+ Add measurement' }));
    expect(screen.getByLabelText('Measurement 2 name')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove measurement 2' }));
    expect(screen.queryByLabelText('Measurement 2 name')).not.toBeInTheDocument();

    // fill the rest of the bill and record
    await userEvent.type(screen.getByLabelText('First Name'), 'Rhea');
    await userEvent.type(screen.getByLabelText('Phone'), '98200 11223');
    await userEvent.click(screen.getByRole('button', { name: 'Cash Memo' }));
    await userEvent.type(screen.getByLabelText('Description'), 'Custom blouse');
    await userEvent.type(screen.getByLabelText('Unit ₹'), '12000');
    await userEvent.type(screen.getByLabelText('Bill Total (₹ rupees)'), '12000');
    await userEvent.click(screen.getByRole('button', { name: 'Record Order' }));

    await screen.findByRole('heading', { name: 'TA-2026-04903' });
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/admin/orders'));
    expect(post?.body).toMatchObject({
      measurementSets: [{ label: 'Blouse', data: { SH: '15 in' } }],
    });

    // a fully removed set is dropped from the POST
    expect((post?.body as { documentIds?: unknown }).documentIds).toBeUndefined();
  });

  it('removing the only measurement set drops the section', async () => {
    mockWizardFetch();
    renderApp('/intake');
    await screen.findByRole('heading', { name: 'Scan Bill' });
    await userEvent.click(screen.getByRole('button', { name: 'Enter manually instead' }));
    await screen.findByRole('button', { name: 'Record Order' });

    await userEvent.click(screen.getByRole('button', { name: '+ Add Measurement Set' }));
    expect(screen.getByLabelText('Set Label')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove set' }));
    expect(screen.queryByLabelText('Set Label')).not.toBeInTheDocument();
  });
});
