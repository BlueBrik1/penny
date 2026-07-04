import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverSources } from '../src/discover-sources.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');

describe('discoverSources', () => {
  it('discovers CSS and JSX under a project folder', () => {
    const { projectRoot, sources, via } = discoverSources(FIXTURES);
    assert.equal(via, 'discover');
    assert.equal(projectRoot, FIXTURES);
    assert.ok(sources.some((s) => s.src.replace(/\\/g, '/').endsWith('sample.css')));
    assert.ok(sources.some((s) => s.src.replace(/\\/g, '/').endsWith('sample.jsx')));
  });
});
