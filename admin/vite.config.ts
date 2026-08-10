import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  if (mode === 'production' && !(process.env.VITE_API_URL ?? loadEnv(mode, process.cwd(), '').VITE_API_URL)) {
    throw new Error('VITE_API_URL must be set for production builds (see PRODUCTION-TODO #8)');
  }
  return {
    plugins: [react()],
    server: { port: 5174 },
    // Pre-bundle the HEIC decoder at startup. Discovered on first use instead,
    // it triggers a dep re-optimisation and full reload that aborts the
    // in-flight conversion.
    optimizeDeps: { include: ['libheif-js/wasm-bundle'] },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.ts',
      // Not a plain `css: false`: vitest's css matcher ignores the ?raw query,
      // so that would also blank the `storefront.css?raw` string PreviewFrame
      // injects into its iframes. Including only the preview mirror leaves it
      // to vite's raw-asset path; every other stylesheet still loads as empty.
      css: { include: [/preview\/storefront\.css/] },
    },
  };
});
