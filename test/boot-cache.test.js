import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('boot cache round-trips when source files unchanged', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'penny-cache-'));
  const srcFile = path.join(tmp, 'Page.jsx');
  fs.writeFileSync(srcFile, 'export default function Page() { return <div className="p-4" />; }');
  process.env.DRIFT_CACHE = path.join(tmp, '.driftcache.json');
  const { buildScanKey, writeBootCache, readBootCache, clearBootCache, cacheToAnalysis } = await import('../src/boot-cache.js');
  const cfg = {
    projectRoot: tmp,
    exclude: [],
    azureOpenAiKey: 'test-key',
    sources: [{ id: 'page', name: 'Page', src: 'Page.jsx' }],
  };
  try {
    clearBootCache();
    writeBootCache(cfg, {
      tokens: [{ name: 'spacing-4', type: 'spacing', value: '16px' }],
      diffTokens: [],
      tokenMode: 'intrinsic',
      pages: [{ id: 'page', drifts: [{ id: 'd1', severity: 'low', type: 'value-drift' }] }],
    });
    const cached = readBootCache(cfg);
    assert.ok(cached);
    assert.equal(cached.pages[0].drifts.length, 1);
    const analysis = cacheToAnalysis(cached, [{ id: 'page', name: 'Page', srcFile: 'Page.jsx' }]);
    assert.equal(analysis.pages[0].drifts.length, 1);
    fs.writeFileSync(srcFile, 'export default function Page() { return <div className="p-8" />; }');
    assert.equal(readBootCache(cfg), null);
  } finally {
    delete process.env.DRIFT_CACHE;
    clearBootCache();
  }
});

test('buildScanKey changes when sources change', async () => {
  const { buildScanKey } = await import('../src/boot-cache.js');
  const cfg = {
    projectRoot: '/tmp/a',
    exclude: [],
    azureOpenAiKey: 'test-key',
    sources: [{ id: 'a', src: 'A.jsx' }],
  };
  const other = { ...cfg, sources: [{ id: 'b', src: 'B.jsx' }] };
  assert.notEqual(buildScanKey(cfg), buildScanKey(other));
});
