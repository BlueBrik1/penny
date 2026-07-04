import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverSources, seedSourcePreset, realSourcePreset } from '../src/discover-sources.js';
import { PACKAGE_ROOT } from '../src/project-paths.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('discoverSources', () => {
  it('discovers real/ pages from repo root', () => {
    const { projectRoot, sources, via } = discoverSources(path.join(ROOT, 'real'));
    assert.equal(via, 'discover');
    assert.equal(projectRoot, path.join(ROOT, 'real'));
    assert.ok(sources.length >= 5);
    assert.ok(sources.some((s) => s.id === 'landing' && s.html));
    assert.ok(sources.some((s) => s.src.endsWith('PricingPage.jsx')));
  });

  it('seed preset points at bundled seed pages', () => {
    const { projectRoot, sources, via } = seedSourcePreset();
    assert.equal(via, 'seed');
    assert.equal(projectRoot, PACKAGE_ROOT);
    assert.ok(sources.some((s) => s.src.includes('seed/')));
  });

  it('real preset loads Meridian pages', () => {
    const { sources, via } = realSourcePreset();
    assert.equal(via, 'real');
    assert.equal(sources.length, 5);
    assert.ok(sources.every((s) => s.id && s.name && s.src));
  });
});
