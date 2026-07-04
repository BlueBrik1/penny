import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichDrifts, MODEL } from '../src/claude.js';

const drifts = [
  { id: 1, category: 'inconsistent-usage', type: 'color', token: { name: 'brand/primary', value: '#ff6b35' }, expected: '#ff6b35', actualValues: ['#ff6b35', '#ff6a34'], locations: [{ file: 'a.css', line: 1, selector: '.x', prop: 'background' }], severity: 'high' },
  { id: 2, category: 'off-palette', type: 'color', token: null, expected: null, actualValues: ['#3b82f6'], locations: [{ file: 'a.css', line: 9, selector: '.y', prop: 'color' }], severity: 'medium' },
];

test('live path sends compact payload and merges model reasoning by id', async () => {
  let sent = null;
  const fakeClient = {
    complete: async (req) => {
      sent = req;
      return '```json\n[{"id":1,"problem":"W1","solution":"F1"},{"id":2,"problem":"W2","solution":"F2"}]\n```';
    },
  };

  const out = await enrichDrifts(drifts, { client: fakeClient });

  assert.equal(sent.deployment, MODEL);
  assert.match(sent.system, /problem/i);
  const payload = JSON.parse(sent.user);
  assert.deepEqual(payload.map((p) => p.id), [1, 2]);

  assert.equal(out[0].problem, 'W1');
  assert.equal(out[0].solution, 'F1');
  assert.equal(out[1].problem, 'W2');
});

test('a drift missing from model output falls back to the rule-based explainer', async () => {
  const fakeClient = {
    complete: async () => '[{"id":1,"problem":"W1","solution":"F1"}]',
  };
  const out = await enrichDrifts(drifts, { client: fakeClient });
  assert.equal(out[0].problem, 'W1');
  assert.ok(out[1].problem && out[1].solution);
  assert.match(out[1].problem, /off-palette/i);
});

test('offline flag skips the client entirely', async () => {
  let called = false;
  const fakeClient = { complete: async () => { called = true; return '[]'; } };
  const out = await enrichDrifts(drifts, { client: fakeClient, offline: true });
  assert.equal(called, false);
  assert.ok(out[0].problem.includes('brand/primary'));
});
