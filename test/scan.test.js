import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLocalScan, formatScanLines } from '../src/scan.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

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
