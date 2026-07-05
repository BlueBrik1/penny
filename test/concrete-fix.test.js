import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPlaceholderValue,
  materializeReplace,
  resolveConcreteValue,
  sanitizeCreativeEdit,
} from '../src/concrete-fix.js';

test('isPlaceholderValue detects TOKEN_NAME and similar', () => {
  assert.ok(isPlaceholderValue('TOKEN_NAME'));
  assert.ok(isPlaceholderValue('text-[TOKEN_NAME]'));
  assert.ok(isPlaceholderValue('[CANONICAL_VALUE]'));
  assert.ok(!isPlaceholderValue('#ffffff'));
  assert.ok(!isPlaceholderValue('text-[#e8e5e0]'));
});

test('materializeReplace builds Tailwind arbitrary class from hex', () => {
  assert.equal(materializeReplace('text-[#e8e5e0]', '#ffffff'), 'text-[#ffffff]');
});

test('sanitizeCreativeEdit resolves placeholder replace from token inventory', () => {
  const lines = ['      className="text-[#e8e5e0] hover:opacity-90"'];
  const out = sanitizeCreativeEdit({
    line: 1,
    find: 'text-[#e8e5e0]',
    replace: 'text-[TOKEN_NAME]',
    before: lines[0],
    after: lines[0].replace('text-[#e8e5e0]', 'text-[TOKEN_NAME]'),
  }, {
    lines,
    expected: 'TOKEN_NAME',
    panelTokens: [
      { name: 'color.text.primary', type: 'color', value: '#ffffff' },
      { name: 'color.bg.surface', type: 'color', value: '#111111' },
    ],
    type: 'color',
    message: 'the color is too dark, make it lighter',
  });
  assert.ok(out);
  assert.equal(out.replace, 'text-[#ffffff]');
  assert.match(out.after, /#ffffff/);
  assert.ok(!out.after.includes('TOKEN'));
});

test('resolveConcreteValue prefers concrete expected over placeholder', () => {
  assert.equal(resolveConcreteValue({
    expected: '#fafafa',
    panelTokens: [],
  }), '#fafafa');
});
