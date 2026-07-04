import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectBridge } from '../src/preview-sidecar.js';
import { resolvePreviewTarget, PREVIEW_KIND } from '../src/preview.js';

test('injectBridge adds script before closing head', () => {
  const out = injectBridge('<html><head></head><body></body></html>', 'http://127.0.0.1:5178/penny-bridge.js');
  assert.match(out, /<script src="http:\/\/127\.0\.0\.1:5178\/penny-bridge\.js"><\/script><\/head>/);
});

test('resolvePreviewTarget uses sidecar URL for jsx', () => {
  const t = resolvePreviewTarget({
    src: 'export default function App() { return <div />; }',
    srcFile: 'App.jsx',
    previewDevServer: 'http://localhost:3000',
    previewProxyUrl: 'http://127.0.0.1:34567',
  });
  assert.equal(t.mode, 'url');
  assert.equal(t.previewUrl, 'http://127.0.0.1:34567/');
  assert.equal(t.kind, PREVIEW_KIND.REACT_JSX);
});

test('resolvePreviewTarget supports previewPath on sidecar', () => {
  const t = resolvePreviewTarget({
    src: 'export default function App() { return <div />; }',
    srcFile: 'App.jsx',
    previewDevServer: 'http://localhost:3000',
    previewProxyUrl: 'http://127.0.0.1:34567',
    previewPath: '/pricing',
  });
  assert.equal(t.previewUrl, 'http://127.0.0.1:34567/pricing');
});
