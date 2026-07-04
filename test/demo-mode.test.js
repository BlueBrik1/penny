import test from 'node:test';
import assert from 'node:assert/strict';

import { hasApiKey, resolveApiKey } from '../src/demo-mode.js';

test('hasApiKey checks config and env', () => {
  assert.equal(hasApiKey({ azureOpenAiKey: 'abc' }), true);
  assert.equal(hasApiKey({ azureOpenAiKey: '' }), false);
});

test('resolveApiKey prefers config over env', () => {
  const prev = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'env-key';
  assert.equal(resolveApiKey({ azureOpenAiKey: 'cfg-key' }), 'cfg-key');
  assert.equal(resolveApiKey({}), 'env-key');
  if (prev === undefined) delete process.env.AZURE_OPENAI_API_KEY;
  else process.env.AZURE_OPENAI_API_KEY = prev;
});
