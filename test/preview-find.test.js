import test from 'node:test';
import assert from 'node:assert/strict';

import { findPreviewElements } from '../src/preview-find.js';

function doc(html) {
  if (typeof Document === 'undefined') {
    return null;
  }
  const d = new Document();
  d.body.innerHTML = html;
  return d;
}

test('findPreviewElements matches Tailwind arbitrary classes', { skip: typeof Document === 'undefined' ? 'no DOM' : false }, () => {
  const d = doc('<nav class="sticky text-[#e8e5e0] top-0">x</nav><div class="nav-item">y</div>');
  const hits = findPreviewElements(d, { kind: 'classContains', value: 'text-[#e8e5e0]' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].tagName, 'NAV');
});

test('findPreviewElements matches inline style colors in React output', { skip: typeof Document === 'undefined' ? 'no DOM' : false }, () => {
  const d = doc('<div style="background: #181818; border: 1px solid #282828">x</div>');
  const hits = findPreviewElements(d, { kind: 'styleContains', value: '#181818' });
  assert.equal(hits.length, 1);
});
