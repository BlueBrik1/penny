import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectPreviewKind, PREVIEW_KIND, buildPreviewDocument, synthesizeHtmlFromCss,
  companionHtmlPath, extractExportName, previewSandbox, prepareReactForBabel,
} from '../src/preview.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('detectPreviewKind for CSS+HTML seed page', () => {
  const css = fs.readFileSync(path.join(root, 'seed/deployed.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'seed/home.html'), 'utf8');
  assert.equal(detectPreviewKind(css, 'deployed.css', html), PREVIEW_KIND.CSS_HTML);
});

test('detectPreviewKind for Tailwind JSX', () => {
  const jsx = fs.readFileSync(path.join(root, 'seed/PricingCard.jsx'), 'utf8');
  assert.equal(detectPreviewKind(jsx, 'PricingCard.jsx', ''), PREVIEW_KIND.TAILWIND_JSX);
});

test('detectPreviewKind for css-only synthesizes preview body', () => {
  const css = '.btn-primary { background: red; }\n.card { padding: 8px; }';
  assert.equal(detectPreviewKind(css, 'styles.css', ''), PREVIEW_KIND.CSS_ONLY);
  const doc = buildPreviewDocument({ src: css, srcFile: 'styles.css', spotSelectors: [] });
  assert.match(doc, /btn-primary/);
  assert.match(doc, /class="btn-primary"/);
});

test('synthesizeHtmlFromCss builds elements for classes', () => {
  const html = synthesizeHtmlFromCss('.foo { color: red; } .bar { margin: 1px; }');
  assert.match(html, /class="foo"/);
  assert.match(html, /class="bar"/);
});

test('companionHtmlPath swaps extension', () => {
  assert.equal(companionHtmlPath('/proj/styles.css'), '/proj/styles.html');
});

test('buildPreviewDocument includes tailwind script for jsx', () => {
  const jsx = fs.readFileSync(path.join(root, 'seed/PricingCard.jsx'), 'utf8');
  const doc = buildPreviewDocument({ src: jsx, srcFile: 'PricingCard.jsx', previewKind: PREVIEW_KIND.TAILWIND_JSX });
  assert.match(doc, /tailwindcss\.com/);
  assert.match(doc, /class=/);
});

test('react preview uses babel and export name', () => {
  const jsx = fs.readFileSync(path.join(root, 'seed/PricingCard.jsx'), 'utf8');
  assert.equal(extractExportName(jsx), 'PricingCard');
  const doc = buildPreviewDocument({ src: jsx, srcFile: 'PricingCard.jsx', previewKind: PREVIEW_KIND.REACT_JSX });
  assert.match(doc, /babel/);
  assert.match(doc, /PricingCard/);
});

test('prepareReactForBabel strips import statements', () => {
  const src = `import React, { useState } from 'react';\nexport function SignupFlow() { const [x] = useState(0); return <div />; }`;
  const out = prepareReactForBabel(src);
  assert.doesNotMatch(out, /^import /m);
  assert.match(out, /useState = React\.useState/);
  assert.match(out, /function SignupFlow/);
});

test('previewSandbox allows scripts for tailwind and react', () => {
  assert.match(previewSandbox(PREVIEW_KIND.TAILWIND_JSX), /allow-scripts/);
  assert.match(previewSandbox(PREVIEW_KIND.REACT_JSX), /allow-scripts/);
  assert.doesNotMatch(previewSandbox(PREVIEW_KIND.CSS_HTML), /allow-scripts/);
});
