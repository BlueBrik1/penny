import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPlaceholderValue,
  materializeReplace,
  resolveConcreteValue,
  sanitizeCreativeEdit,
  editMatchesComplaint,
  inferComplaintProperty,
  inferEditProperty,
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

test('resolveConcreteValue rejects lighter pick when nothing is lighter than current', () => {
  const tokens = [
    { name: 'color.text', type: 'color', value: '#111111' },
    { name: 'color.text.dim', type: 'color', value: '#222222' },
  ];
  const out = resolveConcreteValue({
    panelTokens: tokens,
    find: 'text-[#ffffff]',
    found: ['#ffffff'],
    type: 'color',
    message: 'make it lighter',
  });
  assert.equal(out, null);
});

test('resolveConcreteValue picks larger spacing when user says too small', () => {
  const tokens = [
    { name: 'space.2', type: 'spacing', value: '8px' },
    { name: 'space.4', type: 'spacing', value: '16px' },
    { name: 'space.6', type: 'spacing', value: '24px' },
  ];
  assert.equal(resolveConcreteValue({
    panelTokens: tokens,
    find: 'p-[8px]',
    found: ['8px'],
    type: 'spacing',
    message: 'padding is too small',
  }), '16px');
});

test('resolveConcreteValue rejects smaller pick when user says too small', () => {
  const tokens = [
    { name: 'space.2', type: 'spacing', value: '8px' },
    { name: 'space.4', type: 'spacing', value: '16px' },
  ];
  assert.equal(resolveConcreteValue({
    panelTokens: tokens,
    find: 'p-[16px]',
    found: ['16px'],
    type: 'spacing',
    message: 'too small',
  }), null);
});

test('editMatchesComplaint rejects color complaint with spacing edit', () => {
  assert.equal(inferComplaintProperty('this color is too dark'), 'color');
  assert.equal(inferEditProperty({ find: 'p-[8px]', replace: 'p-[16px]', before: 'p-[8px]', after: 'p-[16px]' }), 'spacing');
  assert.ok(!editMatchesComplaint({
    find: 'p-[8px]', replace: 'p-[16px]', before: 'class="p-[8px]"', after: 'class="p-[16px]"',
  }, 'this color is too dark'));
});

test('editMatchesComplaint accepts color complaint with color edit', () => {
  assert.ok(editMatchesComplaint({
    find: 'text-[#111]', replace: 'text-[#fff]', before: 'text-[#111]', after: 'text-[#fff]',
  }, 'too dark'));
});
