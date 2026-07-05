import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzePageWithAI } from '../src/ai-analyze.js';
import { recordDismissItem } from '../src/dismiss.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'test/fixtures');
const css = fs.readFileSync(path.join(FIX, 'sample.css'), 'utf8');
const html = fs.readFileSync(path.join(FIX, 'sample.html'), 'utf8');

const TOKEN = { name: 'color/#ff6b35', type: 'color', value: '#ff6b35', label: '#ff6b35', color: '#ff6b35' };

test('rules mode (default) never calls the model for drift discovery', async () => {
  let called = false;
  const fakeClient = { complete: async () => { called = true; return '[]'; } };

  const drifts = await analyzePageWithAI({
    pageId: 'home',
    srcFile: 'sample.css',
    src: css,
    diffTokens: [TOKEN],
    panelTokens: [{ ...TOKEN, count: 5 }],
    tokenMode: 'intrinsic',
    client: fakeClient,
    enrichWithAi: false, // offline copy — no LLM at all
  });

  assert.equal(called, false, 'model must not be invoked in rules mode');
  assert.ok(drifts.length > 0);
  assert.ok(drifts.every((d) => d.problem && d.solution));
});

test('rules mode matches diff() + offline enrich and carries deterministic edits', async () => {
  const drifts = await analyzePageWithAI({
    pageId: 'home',
    srcFile: 'sample.css',
    src: css,
    diffTokens: [TOKEN],
    panelTokens: [],
    tokenMode: 'intrinsic',
  });
  assert.ok(drifts.length > 0);
  assert.ok(drifts[0].problem);
  // Deterministic before/after edits are present on fixable drifts without any LLM.
  const fixable = drifts.find((d) => d.category === 'inconsistent-usage' || d.category === 'value-drift');
  assert.ok(fixable, 'expected a fixable drift');
  assert.ok(fixable.aiEdits?.length, 'fixable drift should carry deterministic aiEdits');
  assert.ok(fixable.aiEdits.every((e) => e.before !== e.after), 'edits must change the line');
});

test('rules mode enriches copy + elementName via small-payload LLM call', async () => {
  let sent = null;
  const fakeClient = {
    complete: async (req) => {
      sent = req;
      // enrichDrifts sends an array payload; reply is a copy-only array keyed by id.
      return JSON.stringify([{ id: 1, problem: 'Brand orange is splintered.', solution: 'Use #ff6b35 everywhere.', elementName: 'Brand swatches' }]);
    },
  };
  const drifts = await analyzePageWithAI({
    pageId: 'home',
    srcFile: 'sample.css',
    src: css,
    diffTokens: [TOKEN],
    panelTokens: [{ ...TOKEN, count: 5 }],
    tokenMode: 'intrinsic',
    client: fakeClient,
  });
  assert.ok(sent, 'enrichment call happened');
  assert.doesNotMatch(sent.user, /TOKEN INVENTORY/, 'must not send the full-file scan payload');
  const d1 = drifts.find((d) => d.id === 1);
  assert.equal(d1.problem, 'Brand orange is splintered.');
  assert.ok(d1.locations.some((l) => l.elementName === 'Brand swatches'), 'elementName merged onto locations');
});

test('llm-full mode sends full file content to the model', async () => {
  let sent = null;
  const fakeClient = {
    complete: async (req) => {
      sent = req;
      return JSON.stringify({
        drifts: [{
          category: 'value-drift',
          type: 'color',
          severity: 'high',
          problem: 'Brand drift',
          solution: 'Use #ff6b35',
          token: { name: 'color/#ff6b35', value: '#ff6b35', label: '#ff6b35' },
          expected: '#ff6b35',
          found: ['#ff7038'],
          actualValues: ['#ff7038'],
          elementName: 'Brand swatch C',
          highlight: '.brand-c',
          locations: [{ file: 'sample.css', line: 44, selector: '.brand-c', prop: 'background', value: '#ff7038', raw: '#ff7038', elementName: 'Brand swatch C', highlight: '.brand-c' }],
          edits: [{ line: 44, before: '.brand-c { background: #ff7038; }', after: '.brand-c { background: #ff6b35; }', find: '#ff7038', replace: '#ff6b35' }],
        }],
      });
    },
  };

  const drifts = await analyzePageWithAI({
    pageId: 'home',
    srcFile: 'sample.css',
    src: css,
    html,
    diffTokens: [TOKEN],
    panelTokens: [{ ...TOKEN, count: 5 }],
    tokenMode: 'intrinsic',
    client: fakeClient,
    analysisMode: 'llm-full',
  });

  assert.ok(sent);
  assert.match(sent.user, /sample\.css/);
  assert.match(sent.user, /TOKEN INVENTORY/);
  const d = drifts.find((x) => x.problem === 'Brand drift');
  assert.ok(d, 'expected AI drift merged');
  assert.equal(d.solution, 'Use #ff6b35');
  assert.ok(d.locations.some((l) => l.elementName === 'Brand swatch C'));
});

test('llm-full mode includes page dismissals in the model prompt', async () => {
  let sent = null;
  const fakeClient = {
    complete: async (req) => { sent = req; return JSON.stringify({ drifts: [] }); },
  };
  await analyzePageWithAI({
    pageId: 'navigation',
    srcFile: 'Navigation.jsx',
    src: 'export default function Nav() { return <nav />; }',
    diffTokens: [],
    panelTokens: [],
    tokenMode: 'intrinsic',
    client: fakeClient,
    analysisMode: 'llm-full',
    dismissedItems: [recordDismissItem('navigation', {
      category: 'off-palette',
      type: 'color',
      elementName: 'Nav bar',
      locations: [{ highlight: 'text-[#e8e5e0]', line: 1 }],
    })],
  });
  assert.match(sent.user, /USER DISMISSED/);
  assert.match(sent.user, /Nav bar/);
});
