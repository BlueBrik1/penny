import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePickedElement, findElementInDoc, isInvalidCreativeEdit, sanitizePickedClasses, resolvePickTarget } from '../src/element-highlight.js';

test('normalizePickedElement picks a distinctive Tailwind class', () => {
  const el = normalizePickedElement({
    tag: 'span',
    classes: ['rounded-lg', 'bg-[#ff7038]', 'px-3'],
    text: 'Save',
    selector: 'span.rounded-lg.bg-[#ff7038]',
  });
  assert.equal(el.highlight, 'bg-[#ff7038]');
  assert.match(el.elementName, /span/i);
});

test('normalizePickedElement strips penny-picker classes', () => {
  const el = normalizePickedElement({
    tag: 'a',
    classes: ['rounded-md', 'penny-picker-selected', 'text-[#ffffff]'],
    text: 'Pre-order',
  });
  assert.ok(!el.classes.includes('penny-picker-selected'));
  assert.equal(el.highlight, 'text-[#ffffff]');
});

test('isInvalidCreativeEdit rejects picker noise and Link removal', () => {
  assert.ok(isInvalidCreativeEdit('className="foo"', 'className="foo penny-picker-selected"'));
  assert.ok(isInvalidCreativeEdit('<Link to="/preorder" className="x">', 'className="x"'));
  assert.ok(!isInvalidCreativeEdit(
    '<Link to="/preorder" className="text-[#111]">',
    '<Link to="/preorder" className="text-[#ffffff]">',
  ));
});

test('sanitizePickedClasses removes preview UI classes', () => {
  assert.deepEqual(sanitizePickedClasses(['a', 'penny-picker-hover', 'b']), ['a', 'b']);
});

test('resolvePickTarget stops at button inside nav, not nav container', () => {
  const body = { tagName: 'BODY', nodeType: 1, getAttribute: () => null, parentElement: null };
  const nav = { tagName: 'NAV', nodeType: 1, getAttribute: () => null, parentElement: body };
  const button = {
    tagName: 'BUTTON',
    nodeType: 1,
    getAttribute: () => null,
    parentElement: nav,
  };
  const span = {
    tagName: 'SPAN',
    nodeType: 1,
    getAttribute: () => null,
    parentElement: button,
  };
  assert.equal(resolvePickTarget(span), button);
});

test('findElementInDoc matches by highlight class and text', () => {
  const doc = {
    getElementById: () => null,
    querySelectorAll: (sel) => {
      if (sel === 'button') {
        return [
          { tagName: 'BUTTON', id: '', className: 'px-4 bg-[#ff7038] text-white', innerText: 'Save changes', textContent: 'Save changes', getAttribute: () => null },
          { tagName: 'BUTTON', id: '', className: 'px-4 bg-blue-500', innerText: 'Cancel', textContent: 'Cancel', getAttribute: () => null },
        ];
      }
      if (sel === '*') return [];
      return [];
    },
    querySelector: () => null,
  };
  const hit = findElementInDoc(doc, {
    tag: 'button',
    classes: ['px-4', 'bg-[#ff7038]', 'text-white'],
    highlight: 'bg-[#ff7038]',
    text: 'Save changes',
  });
  assert.ok(hit);
  assert.match(hit.className, /ff7038/);
});
