// Design-fidelity QA: screenshot app pages vs Claude Design reference pages.
// Run from e2e/ so playwright resolves:  node ../scripts/design-qa-shots.mjs
// Prereq: frontend preview on :4173, docker API on :3001.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

const OUT = resolve(import.meta.dirname, '../docs/verification/design-qa');
const REF = (f) => 'file://' + resolve(import.meta.dirname, '../design-reference', f);
mkdirSync(OUT, { recursive: true });

const pairs = [
  { name: 'home', app: 'http://localhost:4173/', ref: REF('Homepage.html') },
  { name: 'collection', app: 'http://localhost:4173/collection/lehenga-sets', ref: REF('Collection.html') },
  { name: 'product', app: 'http://localhost:4173/product/sage-sequin-jacket-lehenga', ref: REF('Product Detail.html') },
];
const viewports = [
  { tag: 'desktop', width: 1440, height: 2400 },
  { tag: 'mobile', width: 390, height: 2400 },
];

const browser = await chromium.launch();
for (const vp of viewports) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: 'reduce', // disable reveal/parallax so shots are stable
  });
  const page = await ctx.newPage();
  for (const p of pairs) {
    for (const [kind, url] of [['app', p.app], ['ref', p.ref]]) {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${p.name}-${vp.tag}-${kind}.png`, fullPage: false });
    }
  }
  await ctx.close();
}
await browser.close();
console.log('shots written to', OUT);
