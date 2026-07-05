import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadTokenFile, resolveTokenFile } from '../src/token-file.js';

function tmpJson(obj) {
  const p = path.join(os.tmpdir(), `penny-tokens-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

test('loadTokenFile normalizes colors/spacing/typography to Penny token shape', () => {
  const p = tmpJson({
    colors: { primary: '#ff6b35', text: '#111111' },
    spacing: { md: '16px' },
    typography: { body: '16px' },
  });
  const tokens = loadTokenFile(p);
  fs.unlinkSync(p);

  const primary = tokens.find((t) => t.name === 'color/primary');
  assert.deepEqual(primary, { name: 'color/primary', type: 'color', value: '#ff6b35', label: '#ff6b35', color: '#ff6b35' });
  const md = tokens.find((t) => t.name === 'spacing/md');
  assert.equal(md.type, 'spacing');
  assert.equal(md.px, 16);
  assert.ok(tokens.some((t) => t.type === 'typography'));
});

test('loadTokenFile rejects an empty token file', () => {
  const p = tmpJson({ nonsense: {} });
  assert.throws(() => loadTokenFile(p));
  fs.unlinkSync(p);
});

test('resolveTokenFile returns null (fallback) when unset or invalid', () => {
  assert.equal(resolveTokenFile({}), null);
  assert.equal(resolveTokenFile({ tokensFile: '/no/such/file.json' }), null);
});
