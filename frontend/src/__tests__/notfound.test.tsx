import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { mockFetch, renderApp } from './helpers';

describe('404 route', () => {
  it('renders the couture 404 page for unknown paths', () => {
    mockFetch(() => undefined);
    renderApp('/does-not-exist');

    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('Page Not Found')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'This thread seems to have come loose.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return Home' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore the Collection' })).toBeInTheDocument();
  });
});
