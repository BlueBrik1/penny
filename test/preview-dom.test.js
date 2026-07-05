import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendToBody, appendToHead, docReady } from '../src/preview-dom.js';

test('appendToBody returns false when body is missing', () => {
  const doc = { createElement: () => ({}) };
  assert.equal(appendToBody(doc, doc.createElement('div')), false);
});

test('appendToHead falls back to documentElement', () => {
  const node = { tag: 'style' };
  const doc = {
    documentElement: { appendChild(n) { this.last = n; } },
    createElement: () => node,
  };
  assert.equal(appendToHead(doc, node), true);
  assert.equal(doc.documentElement.last, node);
});

test('docReady is true when body or head exists', () => {
  assert.equal(docReady({ body: {} }), true);
  assert.equal(docReady({ head: {} }), true);
  assert.equal(docReady({}), false);
});
