import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzePageWithAI } from '../src/ai-analyze.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'seed/deployed.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'seed/home.html'), 'utf8');

test('analyzePageWithAI sends full file content to the model', async () => {
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
                locations: [{ file: 'deployed.css', line: 44, selector: '.brand-c', prop: 'background', value: '#ff7038', raw: '#ff7038', elementName: 'Brand swatch C', highlight: '.brand-c' }],
                edits: [{ line: 44, before: '.brand-c { background: #ff7038; }', after: '.brand-c { background: #ff6b35; }', find: '#ff7038', replace: '#ff6b35' }],
              }],
      });
    },
  };

  const drifts = await analyzePageWithAI({
    pageId: 'home',
    srcFile: 'deployed.css',
    src: css,
    html,
    diffTokens: [{ name: 'color/#ff6b35', type: 'color', value: '#ff6b35', label: '#ff6b35' }],
    panelTokens: [{ name: 'color/#ff6b35', type: 'color', value: '#ff6b35', count: 5 }],
    tokenMode: 'intrinsic',
    client: fakeClient,
  });

  assert.ok(sent);
  assert.match(sent.user, /deployed\.css/);
  assert.match(sent.user, /TOKEN INVENTORY/);
  assert.ok(drifts.length >= 1);
  const d = drifts.find((x) => x.problem === 'Brand drift');
  assert.ok(d, 'expected AI drift merged');
  assert.equal(d.problem, 'Brand drift');
  assert.equal(d.solution, 'Use #ff6b35');
  assert.ok(d.locations.some((l) => l.elementName === 'Brand swatch C'));
});

test('analyzePageWithAI offline path uses rule-based enrich', async () => {
  const drifts = await analyzePageWithAI({
    pageId: 'home',
    srcFile: 'deployed.css',
    src: css,
    diffTokens: [{ name: 'color/#ff6b35', type: 'color', value: '#ff6b35', color: '#ff6b35' }],
    panelTokens: [],
    tokenMode: 'intrinsic',
  });
  assert.ok(drifts.length > 0);
  assert.ok(drifts[0].problem);
});
