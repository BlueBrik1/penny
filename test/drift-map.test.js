import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseSource } from '../src/parse.js';
import { analyzeUsages } from '../src/intrinsic.js';
import { diff } from '../src/diff.js';
import { collectMapMarkers, mapTargetFromLocation } from '../src/drift-map.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(root, 'test/fixtures');
const css = fs.readFileSync(join(FIX, 'sample.css'), 'utf8');

test('collectMapMarkers builds selector targets for drifted elements', async () => {
  const { diffTokens } = await analyzeUsages(parseSource(css, 'sample.css'), { figmaTokens: null });
  const drifts = diff(diffTokens, parseSource(css, 'sample.css'));
  const markers = collectMapMarkers(drifts);
  assert.ok(markers.length > 10);
  assert.ok(markers.some((m) => m.kind === 'selector' && m.value === '.brand-a' && m.color === '#e5484d'));
  assert.ok(markers.every((m) => m.color && m.label));
});

test('mapTargetFromLocation prefers Tailwind class fragment over tag name', () => {
  const m = mapTargetFromLocation({
    selector: 'nav',
    highlight: 'nav',
    raw: 'text-[#e8e5e0]',
    syntax: { kind: 'tw-arb', prefix: 'text' },
  });
  assert.equal(m.kind, 'classContains');
  assert.equal(m.value, 'text-[#e8e5e0]');
});

test('mapTargetFromLocation resolves inline style colors for React JSX', () => {
  const m = mapTargetFromLocation({
    selector: '#181818',
    highlight: '#181818',
    raw: '#181818',
    syntax: { kind: 'css' },
  });
  assert.equal(m.kind, 'styleContains');
  assert.equal(m.value, '#181818');
});
