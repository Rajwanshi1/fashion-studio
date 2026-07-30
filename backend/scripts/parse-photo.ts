/**
 * Run one real photo through one real Claude parse and print what came back.
 *
 * This is the tool for tuning src/services/ai/prompts.ts: the unit tests mock the
 * model and CI has no bills, so the only way to know whether a prompt reads a
 * handwritten page correctly is to send a handwritten page.
 *
 *   npm run parse:photo -- bill ~/Downloads/IMG_3765.HEIC
 *   npm run parse:photo -- measurement page.jpg --model claude-sonnet-5 --effort low
 *
 * Kinds: bill | measurement | shipping_receipt
 * Flags: --model <model id>         override the model configured for the kind
 *        --effort low|medium|high   override the effort configured for the kind
 *
 * Costs real money (a few rupees per run). Needs ANTHROPIC_API_KEY, which it
 * picks up from backend/.env.
 *
 * HEIC is converted with `sips` first: the backend cannot decode iPhone HEIC
 * (sharp rejects its `iref` box), which is why the admin wizard does that work in
 * the browser instead.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createAnthropicClient } from '../src/services/ai/anthropic';
import { AnthropicBillParser, ParseKind } from '../src/services/ai/parser';
import { PARSE_SPECS } from '../src/services/ai/prompts';

/**
 * USD per million tokens, only so the output carries a number worth reasoning
 * about. Rates change — treat this as indicative and the Anthropic console as
 * truth. Sonnet 5 is on introductory pricing ($2/$10) until 2026-08-31, after
 * which it is $3/$15.
 */
const USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};
const USD_TO_INR = 88;

const KINDS = Object.keys(PARSE_SPECS) as ParseKind[];

function bail(msg: string): never {
  console.error(
    `${msg}\n\n  npm run parse:photo -- <${KINDS.join('|')}> <photo> [--model id] [--effort low|medium|high]`,
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : (argv[i + 1] ?? null);
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));

const [kind, rawPath] = positional;
if (!kind || !KINDS.includes(kind as ParseKind)) bail(`Pass a document kind: ${KINDS.join(', ')}`);
if (!rawPath) bail('Pass the path to a photo.');

const file = rawPath.replace(/^~/, homedir());
const spec = PARSE_SPECS[kind as ParseKind];
const model = flag('model') ?? spec.model;
const effort = (flag('effort') ?? spec.effort) as typeof spec.effort;
const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) bail('ANTHROPIC_API_KEY is not set — put it in backend/.env (gitignored) or export it.');

/** Returns JPEG/PNG bytes, converting HEIC through sips when needed. */
function loadImage(p: string): { bytes: Uint8Array; mediaType: string } {
  if (!/\.hei[cf]$/i.test(p)) {
    return { bytes: new Uint8Array(readFileSync(p)), mediaType: /\.png$/i.test(p) ? 'image/png' : 'image/jpeg' };
  }
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'parse-photo-')), 'converted.jpg');
  try {
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', p, '--out', out], { stdio: 'pipe' });
  } catch (err) {
    bail(`Could not convert ${p} with sips (macOS only) — convert it to JPEG first.\n${(err as Error).message}`);
  }
  console.log('(converted HEIC to JPEG via sips)');
  return { bytes: new Uint8Array(readFileSync(out)), mediaType: 'image/jpeg' };
}

type UsageLine = { inputTokens: number | null; outputTokens: number | null; thinkingTokens: number | null; ms: number };

// Wrapped in main() rather than using top-level await: the backend compiles to
// CommonJS, where esbuild rejects it.
async function main(): Promise<void> {
  const image = loadImage(file);

  console.log(`kind    ${kind}`);
  console.log(`photo   ${file} (${(image.bytes.length / 1024).toFixed(0)} KB ${image.mediaType})`);
  console.log(`model   ${model}   effort ${effort}`);

  // PARSE_SPECS drives model and effort, so override them for this run only.
  const original = { model: spec.model, effort: spec.effort };
  spec.model = model;
  spec.effort = effort;

  // The parser logs its own '[parse] usage' line; intercept it so this script can
  // price the call rather than printing the raw line twice.
  let usageLine: UsageLine | null = null;
  const realLog = console.log;
  console.log = (...args: unknown[]) => {
    if (args[0] === '[parse] usage') usageLine = args[1] as UsageLine;
    else realLog(...args);
  };

  let draft: unknown;
  try {
    draft = await new AnthropicBillParser(createAnthropicClient(apiKey)).parse(kind as ParseKind, image);
  } catch (err) {
    console.log = realLog;
    console.error(`\nFAILED: ${(err as Error).message}`);
    process.exit(1);
  } finally {
    console.log = realLog;
    Object.assign(spec, original);
  }

  if (usageLine) {
    const { inputTokens, outputTokens, thinkingTokens, ms } = usageLine as UsageLine;
    const rate = USD_PER_MTOK[model];
    const cost =
      rate && inputTokens != null && outputTokens != null
        ? `~₹${(((inputTokens * rate.input + outputTokens * rate.output) / 1e6) * USD_TO_INR).toFixed(2)}`
        : '(unknown rate)';
    console.log(`\nusage   ${inputTokens} in / ${outputTokens} out (${thinkingTokens ?? 0} thinking) · ${ms} ms · ${cost}`);
  }

  console.log('\ndraft');
  console.log(JSON.stringify(draft, null, 2));
}

void main();
