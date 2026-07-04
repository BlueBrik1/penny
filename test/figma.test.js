// Verifies the live Figma REST path: correct endpoints, auth header, and that the
// response flows through the same normalizer as the offline export. Uses a fake fetch
// backed by the seed's own styles/nodes/variables responses (no network/token).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchFigmaTokens, flattenFrameNodes } from '../src/figma.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exp = JSON.parse(fs.readFileSync(join(root, 'test/fixtures/figma-export.json'), 'utf8'));

test('live pull hits styles -> nodes -> variables and normalizes tokens', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, token: init.headers['X-Figma-Token'] });
    const json = url.includes('/styles') ? exp.styles
      : url.includes('/nodes') ? exp.nodes
        : url.includes('/variables/local') ? exp.variables
          : null;
    return { ok: true, json: async () => json, text: async () => '' };
  };

  const tokens = await fetchFigmaTokens({ token: 'figd_test', fileKey: 'ABC123', fetchImpl: fakeFetch });

  // endpoint sequence + auth header
  assert.ok(calls[0].url.endsWith('/files/ABC123/styles'));
  assert.ok(calls[1].url.includes('/files/ABC123/nodes?ids='));
  assert.ok(calls.some((c) => c.url.endsWith('/files/ABC123/variables/local')));
  assert.equal(calls[0].token, 'figd_test');

  // only FILL/TEXT node ids are requested
  const nodesCall = calls.find((c) => c.url.includes('/nodes?ids='));
  assert.ok(nodesCall.url.includes('1%3A2') || nodesCall.url.includes('1:2'));

  // same normalized output as the offline parser
  assert.equal(tokens.filter((t) => t.type === 'color').length, 8);
  assert.equal(tokens.filter((t) => t.type === 'spacing').length, 7);
  assert.equal(tokens.filter((t) => t.type === 'typography').length, 4);
  const brand = tokens.find((t) => t.name === 'brand/primary');
  assert.equal(brand.value, '#ff6b35');
});

test('a 403 on the enterprise-gated Variables API does not fail the pull', async () => {
  const fakeFetch = async (url) => {
    if (url.includes('/variables/local')) return { ok: false, status: 403, text: async () => 'forbidden' };
    const json = url.includes('/styles') ? exp.styles : exp.nodes;
    return { ok: true, json: async () => json, text: async () => '' };
  };
  const tokens = await fetchFigmaTokens({ token: 't', fileKey: 'K', fetchImpl: fakeFetch });
  assert.equal(tokens.filter((t) => t.type === 'color').length, 8); // colors still come through
  assert.equal(tokens.filter((t) => t.type === 'spacing').length, 0); // spacing (variables) gracefully absent
});

test('flattenFrameNodes converts nested nodes to frame-relative boxes with selector = name', () => {
  const frameDoc = {
    id: '0:1', name: 'Frame', absoluteBoundingBox: { x: 100, y: 200, width: 900, height: 600 },
    children: [
      { id: '1:3', name: '.btn-primary', absoluteBoundingBox: { x: 140, y: 350, width: 170, height: 56 } },
      { id: '1:9', name: '.grid', absoluteBoundingBox: { x: 100, y: 200, width: 600, height: 90 },
        children: [{ id: '1:9a', name: '.card', absoluteBoundingBox: { x: 110, y: 210, width: 185, height: 90 } }] },
    ],
  };
  const nodes = flattenFrameNodes(frameDoc);
  const btn = nodes.find((n) => n.name === '.btn-primary');
  assert.deepEqual({ x: btn.x, y: btn.y, w: btn.w, h: btn.h }, { x: 40, y: 150, w: 170, h: 56 }); // origin-subtracted
  assert.equal(btn.selector, '.btn-primary');
  assert.ok(nodes.find((n) => n.name === '.card'), 'nested child captured');
  assert.equal(nodes.find((n) => n.id === '0:1'), undefined, 'frame itself excluded');
});
