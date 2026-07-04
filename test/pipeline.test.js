// Runnable check for the load-bearing logic: Figma parse -> CSS parse -> semantic diff.
// Fails loudly if clustering, matching, or classification regress. No framework.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseFigmaExport, figmaColorToValue } from '../src/figma.js';
import { parseCss } from '../src/css.js';
import { normalizeColor, colorDistance } from '../src/color.js';
import { diff } from '../src/diff.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = parseFigmaExport(JSON.parse(fs.readFileSync(join(root, 'seed/figma-export.json'), 'utf8')));
const usages = parseCss(fs.readFileSync(join(root, 'seed/deployed.css'), 'utf8'), 'deployed.css');
const drifts = diff(tokens, usages);
const find = (cat, name) => drifts.find((d) => d.category === cat && (d.token?.name === name || name === undefined));

test('color normalization is canonical across notations', () => {
  assert.equal(normalizeColor('#FFF'), '#ffffff');
  assert.equal(normalizeColor('#ff6b35'), '#ff6b35');
  assert.equal(normalizeColor('rgb(255, 107, 53)'), '#ff6b35');
  assert.equal(normalizeColor('rgba(255,107,53,0.5)'), 'rgba(255, 107, 53, 0.5)');
  assert.equal(figmaColorToValue({ r: 1, g: 0.4196, b: 0.2078 }), '#ff6b35');
});

test('perceptual distance clusters near-dups, separates off-palette', () => {
  assert.ok(colorDistance('#ff6b35', '#ff6a34') < 10, 'near-dups are close');
  assert.ok(colorDistance('#ff6b35', '#3b82f6') > 100, 'blue is far from orange');
});

test('Figma export parses all token types', () => {
  assert.equal(tokens.filter((t) => t.type === 'color').length, 8);
  assert.equal(tokens.filter((t) => t.type === 'spacing').length, 7);
  assert.equal(tokens.filter((t) => t.type === 'typography').length, 4);
});

test('Figma tokens carry nodePath labels for the UI', () => {
  const primary = tokens.find((t) => t.name === 'brand/primary');
  assert.ok(primary?.nodePath);
  assert.match(primary.nodePath, /Brand/i);
});

test('CSS parse captures source location', () => {
  const badge = usages.find((u) => u.selector === '.badge' && u.type === 'color');
  assert.equal(badge.value, '#ff6a34');
  assert.equal(badge.line, 90);
  assert.equal(badge.file, 'deployed.css');
});

test('splintered brand color -> high-severity inconsistent-usage', () => {
  const d = find('inconsistent-usage', 'brand/primary');
  assert.ok(d, 'brand/primary flagged inconsistent');
  assert.equal(d.severity, 'high');
  assert.equal(d.actualValues.length, 5);
  assert.deepEqual(new Set(d.actualValues), new Set(['#f9683a', '#fe6830', '#ff6a34', '#ff7038', '#ff6b35']));
  assert.equal(drifts[0].id, 1); // highest severity ranked first
  assert.equal(drifts[0].category, 'inconsistent-usage');
});

test('single-off value -> value-drift, matched to the right token', () => {
  const d = find('value-drift', 'space/md');
  assert.ok(d);
  assert.deepEqual(d.actualValues, ['15px']);
  assert.equal(d.expected, '16px');
});

test('a color with no nearby token -> off-palette', () => {
  const d = find('off-palette');
  assert.ok(d);
  assert.deepEqual(d.actualValues, ['#3b82f6']);
  assert.equal(d.token, null);
});

test('spacing off the scale -> off-scale; near a step -> value-drift', () => {
  assert.ok(find('off-scale'), '13px flagged off-scale');
  const md = find('value-drift', 'space/md');
  assert.ok(md);
  assert.deepEqual(md.actualValues, ['15px']);
});

test('heading sizes that splinter -> inconsistent-usage on text/heading', () => {
  const d = find('inconsistent-usage', 'text/heading');
  assert.ok(d);
  assert.deepEqual([...d.actualValues].sort(), ['30px', '31px', '32px']);
});

test('literal equal to a token is NOT flagged (hardcoding correct values is fine)', () => {
  const d = drifts.find((x) => x.category === 'hardcoded');
  assert.equal(d, undefined);
  assert.ok(!drifts.some((x) => x.token?.name === 'neutral/text' && x.actualValues?.[0] === '#1a1a2e'));
});
