import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeCreativeDrift } from '../src/creative-chat.js';
import { resolvePageForElement } from '../src/interactive.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsx = fs.readFileSync(path.join(root, 'test/fixtures/sample.jsx'), 'utf8');

test('normalizeCreativeDrift accepts edits when strict parser misses the line', () => {
  const raw = {
    category: 'value-drift',
    type: 'color',
    severity: 'medium',
    problem: 'Orange is slightly off brand',
    solution: 'Use the canonical brand orange',
    elementName: 'Brand chip',
    highlight: 'bg-[#ff7038]',
    expected: '#ff6b35',
    found: ['#ff7038'],
    locations: [{ file: 'sample.jsx', line: 999, selector: '.x', raw: '#ff7038' }],
    edits: [{
      line: 999,
      before: 'wrong line',
      after: 'wrong',
      find: '#ff7038',
      replace: '#ff6b35',
    }],
  };
  const d = normalizeCreativeDrift(raw, 'sample.jsx', jsx, {
    tag: 'span',
    classes: ['rounded-lg', 'bg-[#ff7038]', 'px-3'],
    text: '#ff7038',
    selector: 'span.rounded-lg.bg-[#ff7038]',
  });
  assert.ok(d, 'expected lenient normalize');
  assert.ok(d.locations.some((l) => l.line > 0 && jsx.split('\n')[l.line - 1].includes('#ff7038')));
  assert.ok(d.aiEdits?.length || d.locations.length);
  assert.equal(d.locations[0]?.syntax?.kind, 'tw-arb');
  assert.equal(d.highlight, 'bg-[#ff7038]');
});

test('normalizeCreativeDrift builds edit from found/expected and element class', () => {
  const raw = {
    category: 'value-drift',
    type: 'color',
    problem: 'Wrong orange',
    solution: 'Use brand orange',
    highlight: 'bg-[#ff7038]',
    expected: '#ff6b35',
    found: ['#ff7038'],
    locations: [],
    edits: [],
  };
  const d = normalizeCreativeDrift(raw, 'sample.jsx', jsx, {
    classes: ['bg-[#ff7038]'],
    elementName: 'chip',
  });
  assert.ok(d);
  assert.match(d.problem, /Wrong orange/i);
});

test('normalizeCreativeDrift resolves TOKEN_NAME placeholder in edits', () => {
  const raw = {
    category: 'value-drift',
    type: 'color',
    problem: 'Text too dark',
    solution: 'Use a lighter text token',
    highlight: 'text-[#e8e5e0]',
    found: ['#e8e5e0'],
    token: { name: 'color.text.primary', value: '#ffffff' },
    expected: 'TOKEN_NAME',
    edits: [{
      line: 1,
      find: 'text-[#e8e5e0]',
      replace: 'text-[TOKEN_NAME]',
      before: 'className="text-[#e8e5e0]"',
      after: 'className="text-[TOKEN_NAME]"',
    }],
  };
  const src = 'export function Btn() { return <Link className="text-[#e8e5e0]">Go</Link>; }';
  const d = normalizeCreativeDrift(raw, 'nav.jsx', src, null, {
    panelTokens: [{ name: 'color.text.primary', type: 'color', value: '#ffffff' }],
    message: 'color is too dark make lighter',
  });
  assert.ok(d?.aiEdits?.length);
  assert.match(d.aiEdits[0].after, /#ffffff/);
  assert.ok(!d.aiEdits[0].after.includes('TOKEN'));
});

test('resolvePageForElement picks the source file that contains the class', () => {
  const pages = [
    { id: 'landing', name: 'Landing', src: '.hero { color: blue; }' },
    { id: 'navigation', name: 'Navigation', src: 'export function Nav() { return <nav className="text-[#e8e5e0]" />; }' },
  ];
  const id = resolvePageForElement(pages, {
    tag: 'nav',
    classes: ['text-[#e8e5e0]'],
    highlight: 'text-[#e8e5e0]',
  }, 'landing');
  assert.equal(id, 'navigation');
});
