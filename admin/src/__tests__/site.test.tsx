import { screen } from '@testing-library/react';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';

describe('site content list', () => {
  it('shows a card per section with customised/default badges', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/content')) {
        return { json: { sections: { hero: { title: 'Custom headline' } } } };
      }
      return undefined;
    });

    renderApp('/site');

    expect(await screen.findByText('Hero')).toBeInTheDocument();
    expect(screen.getByText('Announcement Bar')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
    // hero row is customised, the rest default
    expect(screen.getAllByText('Customised')).toHaveLength(1);
    expect(screen.getAllByText('Default').length).toBeGreaterThan(3);
    // the customised value is what the card previews
    expect(screen.getByText('Custom headline')).toBeInTheDocument();
  });

  it('previews built-in defaults and links each card to its editor', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/content')) return { json: { sections: {} } };
      return undefined;
    });

    renderApp('/site');

    expect(await screen.findByText('Tanvi Agnihotry', { selector: '.prev' })).toBeInTheDocument();
    // ticker preview joins its messages and truncates with an ellipsis
    const ticker = screen.getByText(/^Complimentary Made-to-Order Consultation · Worldwide Shipping/);
    expect(ticker).toHaveTextContent(/…$/);
    expect(screen.getByRole('link', { name: /Hero/ })).toHaveAttribute('href', '/site/hero');
    expect(screen.getByRole('link', { name: /Announcement Bar/ })).toHaveAttribute(
      'href',
      '/site/ticker',
    );
  });
});
