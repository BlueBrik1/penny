import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLocalScan, formatScanLines } from '../src/scan.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(ROOT, 'test/fixtures/sample.css');

test('--no-ai forces the rules path even when a key is configured (no LLM call)', async () => {
  const cfg = { projectRoot: ROOT, sources: [], azureOpenAiKey: 'test-key', dismissedItems: [] };
  // A real key is set; noAi must keep aiLive false and never invoke the network client.
  const result = await runLocalScan(cfg, { css: SAMPLE, noAi: true, dryRun: true });
  assert.equal(result.aiLive, false);
  assert.equal(result.via, 'rules');
  assert.equal(result.analysisMode, 'rules');
  assert.ok(result.total > 0, 'rules scan still finds drift in the drifted fixture');
});

test('--fail-on-drift: drifted fixture yields total > 0 (exit-1 signal)', async () => {
  const cfg = { projectRoot: ROOT, sources: [], azureOpenAiKey: '', dismissedItems: [] };
  const result = await runLocalScan(cfg, { css: SAMPLE, noAi: true, dryRun: true });
  assert.ok(result.total > 0); // cli exits 1 when fail-on-drift && total > 0
  // verboseJson attaches full drift detail for machine consumers
  const verbose = await runLocalScan(cfg, { css: SAMPLE, noAi: true, dryRun: true, verboseJson: true });
  assert.ok(verbose.pages[0].drifts?.length, 'verbose-json includes drift details');
});

test('runLocalScan returns zero when no sources configured', async () => {
  const cfg = {
    projectRoot: ROOT,
    sources: [],
    azureOpenAiKey: 'test-key',
    dismissed: [],
    dismissedItems: [],
  };
  const result = await runLocalScan(cfg, { dryRun: true });
  assert.equal(result.total, 0);
  assert.equal(result.aiLive, false);
  assert.ok(formatScanLines(result).some((l) => l.includes('drift')));
});
