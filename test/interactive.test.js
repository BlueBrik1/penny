import test from 'node:test';
import assert from 'node:assert/strict';

import { spotlightSelectorsFromDrift } from '../src/interactive.js';
import { buildPreviewDocument, PREVIEW_KIND, buildPulseCss } from '../src/preview.js';

test('spotlightSelectorsFromDrift prefers highlight over generic selector', () => {
  const drift = {
    highlight: 'hero-cta',
    locations: [{ selector: 'body', highlight: 'btn-primary', raw: 'btn-primary' }],
  };
  const sels = spotlightSelectorsFromDrift(drift);
  assert.ok(sels.includes('hero-cta'));
  assert.ok(sels.includes('btn-primary'));
  assert.ok(!sels.includes('body'));
});

test('buildPreviewDocument spotlight CSS brightens matched elements', () => {
  const doc = buildPreviewDocument({
    src: '.btn-primary { background: red; }',
    srcFile: 'x.css',
    previewKind: PREVIEW_KIND.CSS_ONLY,
    spotSelectors: ['.btn-primary'],
  });
  assert.match(doc, /brightness\(1\.22\)/);
  assert.match(doc, /pv-dim/);
});

test('buildPulseCss maps tailwind class fragments', () => {
  const css = buildPulseCss(['px-[18px]'], true);
  assert.match(css, /\[class\*="px-\[18px\]"\]/);
  assert.match(css, /brightness/);
});
