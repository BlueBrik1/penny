import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyPlan, computeFixPlan } from '../src/fixer.js';

test('revert restores session original, not post-apply disk content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'penny-revert-'));
  const file = path.join(dir, 'Button.jsx');
  const original = 'export default function Btn() { return <button className="text-[#aaaaaa]">Save</button>; }';
  fs.writeFileSync(file, original);

  const page = { original, src: original, readPath: file, writePath: file };
  const drift = {
    id: 1,
    category: 'value-drift',
    type: 'color',
    aiEdits: [{
      line: 1,
      before: original,
      after: original.replace('#aaaaaa', '#ffffff'),
      find: '#aaaaaa',
      replace: '#ffffff',
    }],
    locations: [{ line: 1, file: 'Button.jsx', raw: '#aaaaaa' }],
  };

  const plan = computeFixPlan(page.src, [drift]);
  const fixed = applyPlan(page.src, plan, [1]);
  fs.writeFileSync(file, fixed);
  page.src = fixed;

  assert.notEqual(fs.readFileSync(file, 'utf8'), original);

  page.src = page.original;
  fs.writeFileSync(page.writePath, page.original);

  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(page.src, original);
});
