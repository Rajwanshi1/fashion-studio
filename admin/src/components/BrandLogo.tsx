import logo from '../assets/brand-logo.png';

/** Official brand mark — the provided logo PNG (background alpha-keyed out). */
export default function BrandLogo({ size = '1.4em' }: { size?: string }) {
  return (
    <img
      src={logo}
      alt=""
      aria-hidden="true"
      style={{
        height: size,
        width: 'auto',
        display: 'inline-block',
        verticalAlign: '-0.34em',
        marginRight: '0.45em',
      }}
    />
  );
}
