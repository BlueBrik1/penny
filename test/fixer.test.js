// Runnable check for the CSS fix engine: plan generation, application, and the
// round-trip property that fixing + re-diffing actually clears the fixed drifts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseFigmaExport } from '../src/figma.js';
import { parseCss } from '../src/css.js';
import { diff } from '../src/diff.js';
import { computeFixPlan, applyPlan, isFixable, hasApplicableEdits } from '../src/fixer.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(root, 'test/fixtures');
const tokens = parseFigmaExport(JSON.parse(fs.readFileSync(join(FIX, 'figma-export.json'), 'utf8')));
const css = fs.readFileSync(join(FIX, 'sample.css'), 'utf8');
const drifts = diff(tokens, parseCss(css, 'deployed.css'));
const plan = computeFixPlan(css, drifts);

test('only value-drift and inconsistent-usage are fixable', () => {
  assert.equal(isFixable({ category: 'value-drift' }), true);
  assert.equal(isFixable({ category: 'inconsistent-usage' }), true);
  assert.equal(isFixable({ category: 'off-palette' }), false);
  assert.equal(isFixable({ category: 'hardcoded' }), false);
});

test('hasApplicableEdits is false when before equals after', () => {
  assert.equal(hasApplicableEdits({ edits: [{ before: 'a', after: 'a' }] }), false);
  assert.equal(hasApplicableEdits({ edits: [{ before: 'a', after: 'b' }] }), true);
  assert.equal(hasApplicableEdits(null), false);
  for (const item of plan) assert.ok(hasApplicableEdits(item), item.token);
  const advisory = drifts.filter((d) => !isFixable(d));
  for (const d of advisory) assert.equal(plan.find((p) => p.id === d.id), undefined);
});

test('plan produces real before/after line diffs', () => {
  const brand = plan.find((p) => p.token === 'brand/primary');
  assert.ok(brand);
  const badge = brand.edits.find((e) => e.selector === '.badge');
  assert.equal(badge.line, 90);
  assert.equal(badge.find, '#ff6a34');
  assert.equal(badge.replace, '#ff6b35');
  assert.match(badge.before, /#ff6a34/);
  assert.match(badge.after, /#ff6b35/);
  assert.doesNotMatch(badge.after, /#ff6a34/);
});

test('applyPlan snaps drifted values to the token, and re-diff clears them', () => {
  const fixed = applyPlan(css, plan);
  // the three splintered oranges collapse to one
  const oranges = [...fixed.matchAll(/#ff6[ab]3[45]|#f9683a/g)].map((m) => m[0]);
  assert.ok(oranges.every((o) => o === '#ff6b35'), 'all brand oranges normalized');

  const after = diff(tokens, parseCss(fixed, 'deployed.css'));
  const fixableLeft = after.filter(isFixable);
  assert.equal(fixableLeft.length, 0, 'no fixable drift remains');
  // off-palette / off-scale are advisory and correctly left untouched
  assert.ok(after.some((d) => d.category === 'off-palette'));
});

test('accept-edits: apply only accepted ids, and honor an override value', () => {
  const md = plan.find((p) => p.token === 'space/md');
  md.edits[0].override = '16px'; // user-edited value in accept-edits mode
  const fixed = applyPlan(css, plan, [md.id]);
  assert.match(fixed, /padding: 16px/);          // accepted drift applied
  assert.match(fixed, /background: #ff6a34/);      // non-accepted drift untouched
});
