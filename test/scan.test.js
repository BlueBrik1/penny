import test from 'node:test';
import assert from 'node:assert/strict';

import { runLocalScan, formatScanLines } from '../src/scan.js';
import { loadConfig } from '../src/config.js';

test('runLocalScan returns drift counts for bundled demo', async () => {
  const cfg = { ...loadConfig(), azureOpenAiKey: '', demoMode: true, dismissed: [] };
  const result = await runLocalScan(cfg, { dryRun: true });
  assert.ok(result.total > 0);
  assert.equal(result.demoMode, true);
  assert.ok(result.pages.length >= 1);
  assert.ok(formatScanLines(result).some((l) => l.includes('drift')));
});
