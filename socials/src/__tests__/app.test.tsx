import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';
import { SOCIALS } from '../config';

describe('Socials link-in-bio page', () => {
  it('renders exactly the 6 links from config, each with its configured href', () => {
    render(<App />);

    SOCIALS.links.forEach((link) => {
      const anchor = screen.getByRole('link', { name: new RegExp(link.label) });
      expect(anchor).toHaveAttribute('href', link.href);
    });
    expect(screen.getAllByRole('link')).toHaveLength(SOCIALS.links.length);
  });

  it('shows the wordmark and tagline', () => {
    render(<App />);

    expect(screen.getAllByText(SOCIALS.wordmark).length).toBeGreaterThan(0);
    expect(screen.getByText(SOCIALS.tagline)).toBeInTheDocument();
  });

  it('shows The Studio address and hours', () => {
    render(<App />);

    expect(screen.getByText('The Studio')).toBeInTheDocument();
    SOCIALS.studio.forEach((line) => {
      expect(screen.getByText(line)).toBeInTheDocument();
    });
    expect(screen.getByText(SOCIALS.hours)).toBeInTheDocument();
  });

  it('shows the footer copyright line', () => {
    render(<App />);

    expect(screen.getByText(`© 2026 ${SOCIALS.wordmark}`)).toBeInTheDocument();
  });
});
