import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseSource } from '../src/parse.js';
import { analyzeUsages } from '../src/intrinsic.js';
import { diff } from '../src/diff.js';
import { collectMapMarkers } from '../src/drift-map.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(join(root, 'seed/deployed.css'), 'utf8');

test('collectMapMarkers builds selector targets for drifted elements', async () => {
  const { diffTokens } = await analyzeUsages(parseSource(css, 'deployed.css'), { figmaTokens: null });
  const drifts = diff(diffTokens, parseSource(css, 'deployed.css'));
  const markers = collectMapMarkers(drifts);
  assert.ok(markers.length > 10);
  assert.ok(markers.some((m) => m.kind === 'selector' && m.value === '.brand-a' && m.color === '#e5484d'));
  assert.ok(markers.every((m) => m.color && m.label));
});
