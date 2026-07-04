import test from 'node:test';
import assert from 'node:assert/strict';

import {
  elementIdentity,
  recordDismissItem,
  isSimilarDismissed,
  appendDismissItem,
  formatDismissedForPrompt,
} from '../src/dismiss.js';

const navDrift = {
  category: 'off-palette',
  type: 'color',
  elementName: 'Navigation bar background',
  locations: [{ highlight: 'text-[#e8e5e0]', line: 20, selector: 'nav' }],
};

const navSpacing = {
  category: 'off-scale',
  type: 'spacing',
  elementName: 'Nav links row',
  locations: [{ highlight: 'gap-7', line: 46, selector: '.nav-links' }],
};

test('elementIdentity prefers highlight over generic selector', () => {
  assert.equal(elementIdentity(navDrift), 'text-[#e8e5e0]');
});

test('isSimilarDismissed is scoped to page and element', () => {
  const items = [recordDismissItem('navigation', navDrift)];
  assert.ok(isSimilarDismissed('navigation', navDrift, items));
  assert.ok(!isSimilarDismissed('brandfooter', navDrift, items));
  assert.ok(!isSimilarDismissed('navigation', navSpacing, items));
});

test('isSimilarDismissed blocks same issue kind on same element after rescan', () => {
  const items = [recordDismissItem('navigation', navDrift)];
  const rescan = {
    ...navDrift,
    actualValues: ['#e8e5e1'],
    problem: 'Slightly different wording from AI',
  };
  assert.ok(isSimilarDismissed('navigation', rescan, items));
});

test('appendDismissItem dedupes identical dismissals', () => {
  const cfg = { dismissedItems: [] };
  const item = recordDismissItem('navigation', navDrift);
  const a = appendDismissItem(cfg, item);
  const b = appendDismissItem({ dismissedItems: a }, item);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
});

test('formatDismissedForPrompt lists dismissed elements for the model', () => {
  const text = formatDismissedForPrompt([recordDismissItem('navigation', navDrift)]);
  assert.match(text, /USER DISMISSED/);
  assert.match(text, /Navigation bar background/);
  assert.match(text, /do NOT report/i);
});
