/**
 * Cross-engine check for the Scan Bill photo pipeline.
 *
 * iPhone HEIC is not one format. 12 MP photos use a baseline profile most
 * decoders read, while 24 MP photos (iPhone 15 Pro and later) use the 10-bit
 * `heix` profile that older libheif builds reject outright — and Chromium and
 * Firefox have no HEIC decoder at all, so they depend entirely on the bundled
 * wasm one. A regression here is invisible to the unit tests, which mock the
 * decoder, and to CI, which has no iPhone photos.
 *
 * Run it against a folder of real photos:
 *
 *   HEIC_DIR=~/Downloads node heic-matrix.mjs
 *
 * Requires the admin app and API running (npm run dev in admin/ and backend/).
 * Reports one line per file per engine and exits non-zero on any failure.
 */
import { chromium, firefox, webkit } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const DIR = process.env.HEIC_DIR?.replace(/^~/, homedir());
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@tanviagnihotry.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'TanviAdmin@2026';
const LIMIT = Number(process.env.HEIC_LIMIT ?? 8);

if (!DIR) {
  console.log('Set HEIC_DIR to a folder of iPhone photos, e.g. HEIC_DIR=~/Downloads node heic-matrix.mjs');
  process.exit(0);
}

const files = readdirSync(DIR)
  .filter((f) => /\.hei[cf]$/i.test(f))
  .sort()
  .slice(0, LIMIT);

if (files.length === 0) {
  console.log(`No HEIC files found in ${DIR}`);
  process.exit(0);
}

/**
 * Builds the File in page context from real bytes: the wizard clears
 * input.files once it has handled the change event, so it cannot be read back.
 */
const PROBE = async ({ name, b64 }) => {
  const show = (e) => {
    if (e instanceof Error) return `${e.name}: ${e.message}`;
    if (e && typeof e === 'object') return JSON.stringify(e).slice(0, 200);
    return String(e);
  };
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], name, { type: 'image/heic' });

  const out = {};
  try {
    const bitmap = await createImageBitmap(file);
    out.native = `${bitmap.width}x${bitmap.height}`;
    bitmap.close?.();
  } catch {
    out.native = 'unsupported';
  }
  try {
    const { prepareImage } = await import('/src/lib/image.ts');
    const { blob } = await prepareImage(file);
    out.result = `OK ${(blob.size / 1024).toFixed(0)}KB`;
    out.ok = true;
  } catch (e) {
    out.result = `FAIL ${show(e)}`;
    out.ok = false;
  }
  return out;
};

let failures = 0;

for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
  let browser;
  try {
    browser = await launcher.launch();
  } catch (e) {
    console.log(`\n${engine}: not installed — npx playwright install ${engine}`);
    continue;
  }
  const page = await browser.newPage();
  let usedWasm = false;
  page.on('response', (r) => {
    if (/libheif/i.test(r.url())) usedWasm = true;
  });

  console.log(`\n${engine} ${browser.version()}`);

  await page.goto(`${ADMIN}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
  await page.goto(`${ADMIN}/intake`);
  await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 20_000 });

  for (const name of files) {
    const b64 = readFileSync(`${DIR}/${name}`).toString('base64');
    const r = await page.evaluate(PROBE, { name, b64 });
    if (!r.ok) failures++;
    console.log(`  ${name.padEnd(18)} browser decode: ${r.native.padEnd(12)} ${r.result}`);
  }
  console.log(`  wasm decoder downloaded: ${usedWasm ? 'yes' : 'no (browser decoded natively)'}`);

  await browser.close();
}

console.log(failures === 0 ? '\nAll files converted.' : `\n${failures} file(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
