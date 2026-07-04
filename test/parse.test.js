// Checks for the design-language-agnostic parser and in-language fixes: a Tailwind/JSX
// source drifts against the same seed tokens, and fixes stay Tailwind classes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseFigmaExport } from '../src/figma.js';
import { parseSource } from '../src/parse.js';
import { diff } from '../src/diff.js';
import { computeFixPlan, applyPlan, renderCanonical } from '../src/fixer.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(root, 'test/fixtures');
const tokens = parseFigmaExport(JSON.parse(fs.readFileSync(join(FIX, 'figma-export.json'), 'utf8')));
const jsx = fs.readFileSync(join(FIX, 'sample.jsx'), 'utf8');

test('parseSource reads Tailwind arbitrary values, scale classes, and inline colors', () => {
  const u = parseSource('<div className="bg-[#ff6b35] p-6 text-[18px]" style={{color:"#fff"}} />', 'x.jsx');
  const by = (t) => u.filter((x) => x.type === t).map((x) => x.raw).sort();
  assert.deepEqual(by('color'), ['#fff', 'bg-[#ff6b35]']);
  assert.deepEqual(by('spacing'), ['p-6']);       // 6 * 4 = 24px
  assert.deepEqual(by('typography'), ['text-[18px]']);
  assert.equal(u.find((x) => x.raw === 'p-6').px, 24);
});

test('hex mentioned only in a comment is not a usage', () => {
  const u = parseSource('// brand is #ff6b35\n<div className="p-4" />', 'x.jsx');
  assert.equal(u.some((x) => x.type === 'color'), false);
});

test('renderCanonical rewrites canonical values back into each language', () => {
  assert.equal(renderCanonical({ syntax: { kind: 'tw-arb', prefix: 'bg' } }, { type: 'color', expected: '#ff6b35' }), 'bg-[#ff6b35]');
  assert.equal(renderCanonical({ syntax: { kind: 'tw-space', prefix: 'p' } }, { type: 'spacing', expected: '16px' }), 'p-4');
  assert.equal(renderCanonical({ syntax: { kind: 'tw-space', prefix: 'p' } }, { type: 'spacing', expected: '15px' }), 'p-[15px]');
  assert.equal(renderCanonical({ syntax: { kind: 'css' } }, { type: 'color', expected: '#ff6b35' }), '#ff6b35');
});

test('JSX drift: splintered oranges collapse and fixes stay Tailwind classes', () => {
  const drifts = diff(tokens, parseSource(jsx, 'PricingCard.jsx'));
  assert.ok(drifts.some((d) => d.category === 'inconsistent-usage' && d.token?.name === 'brand/primary'));

  const fixed = applyPlan(jsx, computeFixPlan(jsx, drifts));
  assert.match(fixed, /bg-\[#ff6b35\]/);            // rewritten as a Tailwind class, not raw hex
  assert.doesNotMatch(fixed, /bg-\[#ff6a34\]|bg-\[#f9683a\]/);
  assert.match(fixed, /p-\[16px\]/);                // 15px -> space/md 16px, still arbitrary class
});

test('config round-trips to disk', async () => {
  const tmp = join(os.tmpdir(), `driftrc-test-${process.pid}.json`);
  process.env.DRIFTRC = tmp;
  const mod = await import('../src/config.js');
  mod.saveConfig({ ...mod.loadConfig(), scanMode: 'watch', exclude: ['vendor/x.css'] });
  const back = mod.loadConfig();
  assert.equal(back.scanMode, 'watch');
  assert.deepEqual(back.exclude, ['vendor/x.css']);
  fs.rmSync(tmp, { force: true });
});
