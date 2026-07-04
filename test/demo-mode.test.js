import test from 'node:test';
import assert from 'node:assert/strict';

import { isDemoMode, loadDemoSnapshot, demoSourceDefs, demoDriftsForPage } from '../src/demo-mode.js';

test('isDemoMode when no API key', () => {
  delete process.env.AZURE_OPENAI_API_KEY;
  assert.equal(isDemoMode({ azureOpenAiKey: '' }), true);
});

test('isDemoMode false when key in config or env', () => {
  assert.equal(isDemoMode({ azureOpenAiKey: 'azure-key' }), false);
  process.env.AZURE_OPENAI_API_KEY = 'azure-env';
  assert.equal(isDemoMode({ azureOpenAiKey: '' }), false);
  delete process.env.AZURE_OPENAI_API_KEY;
});

test('demo snapshot has drifts for seed pages', () => {
  const snap = loadDemoSnapshot();
  assert.ok(snap);
  assert.ok(snap.pages.length >= 3);
  assert.ok(snap.tokens.length > 0);
  const home = demoDriftsForPage('home', snap);
  assert.ok(home.length > 0);
});

test('demoSourceDefs returns seed pages only', () => {
  const defs = demoSourceDefs();
  assert.equal(defs.length, 3);
  assert.ok(defs.every((d) => d.seed === true));
});
