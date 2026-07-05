import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceDisplayValue, coerceDisplayValues, finalizeDrift } from '../src/drift-format.js';

test('coerceDisplayValue extracts strings from computedStyle blobs', () => {
  const cs = { color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(255, 107, 53)' };
  assert.equal(coerceDisplayValue(cs, 'color'), 'rgb(255, 107, 53)');
  assert.deepEqual(coerceDisplayValues([cs], 'color'), [
    'rgb(255, 107, 53)',
    'rgb(255, 255, 255)',
  ]);
});

test('finalizeDrift normalizes object found/expected values', () => {
  const d = finalizeDrift({
    category: 'value-drift',
    type: 'color',
    severity: 'medium',
    problem: 'wrong color',
    solution: 'use token',
    expected: { color: '#fff', backgroundColor: '#ff6b35' },
    found: [{ color: '#ff7038', backgroundColor: 'rgba(0,0,0,0)' }],
    locations: [{ file: 'a.jsx', line: 1, selector: '.btn' }],
  });
  assert.equal(d.expected, '#ff6b35');
  assert.ok(d.actualValues.every((v) => typeof v === 'string'));
  assert.ok(d.actualValues.includes('#ff7038'));
});
