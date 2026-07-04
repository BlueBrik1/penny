import test from 'node:test';
import assert from 'node:assert/strict';

import { hooksHelpText } from '../src/agent-hooks-tutorial.js';

test('hooksHelpText mentions hook files and penny scan', () => {
  const text = hooksHelpText();
  assert.match(text, /penny-scan\.js/);
  assert.match(text, /penny scan/);
  assert.match(text, /\.claude\/settings\.json/);
  assert.match(text, /\.cursor\/hooks\.json/);
});
