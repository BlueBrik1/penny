import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSource, termSafe } from '../src/tui-terminal.js';
import { snapshotToTui } from '../src/web-client.js';

test('normalizeSource strips CR without changing line count', () => {
  const raw = 'line one\r\nline two\r\n';
  const norm = normalizeSource(raw);
  assert.equal(norm, 'line one\nline two\n');
  assert.equal(norm.split('\n').length, 3);
});

test('termSafe removes carriage returns that break terminal columns', () => {
  const line = "  color: red;\r";
  assert.equal(termSafe(line), '  color: red;');
  assert.ok(!termSafe('a\r|b').includes('\r'));
});

test('snapshotToTui resolves path from config when sources list is empty', () => {
  const snap = {
    tokenMode: 'intrinsic',
    tokens: [],
    pages: [{
      id: 'app',
      name: 'App',
      srcFile: 'App.css',
      src: '.x { color: red; }',
      drifts: [],
    }],
  };
  const cfg = {
    projectRoot: '/proj',
    sources: [{ id: 'app', name: 'App', src: 'src/App.css' }],
  };
  const { pages } = snapshotToTui(snap, [], cfg);
  assert.ok(pages[0].path.replace(/\\/g, '/').endsWith('/proj/src/App.css'));
  assert.equal(pages[0].src, undefined);
});
