import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldRunAgentHookScan,
  shouldWatchScan,
  shouldIntervalScan,
} from '../src/config.js';

test('agent hook scan only runs in agent mode', () => {
  assert.equal(shouldRunAgentHookScan({ scanMode: 'agent' }), true);
  assert.equal(shouldRunAgentHookScan({ scanMode: 'ondemand' }), false);
  assert.equal(shouldRunAgentHookScan({ scanMode: 'watch' }), false);
  assert.equal(shouldRunAgentHookScan({ scanMode: 'interval' }), false);
});

test('watch scan only in watch or autonomous mode', () => {
  assert.equal(shouldWatchScan({ scanMode: 'watch' }), true);
  assert.equal(shouldWatchScan({ scanMode: 'autonomous' }), true);
  assert.equal(shouldWatchScan({ scanMode: 'ondemand' }), false);
  assert.equal(shouldWatchScan({ scanMode: 'agent' }), false);
});

test('interval scan only in interval mode', () => {
  assert.equal(shouldIntervalScan({ scanMode: 'interval' }), true);
  assert.equal(shouldIntervalScan({ scanMode: 'ondemand' }), false);
});
