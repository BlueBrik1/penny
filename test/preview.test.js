import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectPreviewKind, PREVIEW_KIND, buildPreviewDocument, synthesizeHtmlFromCss,
  companionHtmlPath, extractExportName, previewSandbox, prepareReactForBabel,
  hasExternalImports, resolvePreviewTarget,
} from '../src/preview.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const FIX = path.join(root, 'test/fixtures');

test('detectPreviewKind for CSS+HTML page', () => {
  const css = fs.readFileSync(path.join(FIX, 'sample.css'), 'utf8');
  const html = fs.readFileSync(path.join(FIX, 'sample.html'), 'utf8');
  assert.equal(detectPreviewKind(css, 'sample.css', html), PREVIEW_KIND.CSS_HTML);
});

test('detectPreviewKind for Tailwind JSX', () => {
  const jsx = fs.readFileSync(path.join(FIX, 'sample.jsx'), 'utf8');
  assert.equal(detectPreviewKind(jsx, 'sample.jsx', ''), PREVIEW_KIND.REACT_JSX);
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
  const jsx = fs.readFileSync(path.join(FIX, 'sample.jsx'), 'utf8');
  const doc = buildPreviewDocument({ src: jsx, srcFile: 'sample.jsx' });
  assert.match(doc, /tailwindcss\.com/);
  assert.match(doc, /babel/);
  assert.match(doc, /PricingCard/);
});

test('hasExternalImports detects local imports', () => {
  assert.equal(hasExternalImports(`import X from './Foo';\nexport function App() { return <X />; }`), true);
  assert.equal(hasExternalImports(`import React from 'react';\nexport function App() { return <div />; }`), false);
});

test('resolvePreviewTarget uses dev server for multi-file jsx', () => {
  const src = `import Hero from './Hero';\nexport function Page() { return <Hero />; }`;
  const t = resolvePreviewTarget({
    src, srcFile: 'Page.jsx', previewDevServer: 'http://localhost:3000', previewPath: '/pricing',
    previewProxyUrl: 'http://127.0.0.1:34567',
  });
  assert.equal(t.mode, 'url');
  assert.equal(t.previewUrl, 'http://127.0.0.1:34567/pricing');
});

test('resolvePreviewTarget uses dev server for standalone jsx when previewDevServer set', () => {
  const src = `export default function PartnerMarquee() { return <div />; }`;
  const t = resolvePreviewTarget({
    src, srcFile: 'PartnerMarquee.jsx', previewDevServer: 'http://localhost:3000',
    previewProxyUrl: 'http://127.0.0.1:34567',
  });
  assert.equal(t.mode, 'url');
  assert.equal(t.previewUrl, 'http://127.0.0.1:34567/');
});

test('react preview uses babel and export name', () => {
  const jsx = fs.readFileSync(path.join(FIX, 'sample.jsx'), 'utf8');
  assert.equal(extractExportName(jsx), 'PricingCard');
  const doc = buildPreviewDocument({ src: jsx, srcFile: 'sample.jsx', previewKind: PREVIEW_KIND.REACT_JSX });
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
