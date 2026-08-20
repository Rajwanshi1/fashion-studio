import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp } from './helpers';

// ClientCare is a static page — only the nav/footer fetches fire, and the
// 404 fallback in mockFetch is harmless for them.
const NOTICE = /first-party analytics/i;

describe('ConsentNotice', () => {
  it('shows the notice with a link to client care, until acknowledged', async () => {
    mockFetch(() => undefined);
    renderApp('/client-care');

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /client care & privacy/i })).toHaveAttribute(
      'href',
      '/client-care',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Okay' }));
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    expect(localStorage.getItem('ta.consent-ack')).toBe('1');
  });

  it('stays dismissed on later visits once acknowledged', () => {
    localStorage.setItem('ta.consent-ack', '1');
    mockFetch(() => undefined);
    renderApp('/');

    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
