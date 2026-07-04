#!/usr/bin/env node
// Generate seed/demo-snapshot.json from bundled seed pages (offline pipeline).
// Re-run after seed CSS changes, or with AZURE_OPENAI_API_KEY for live AI snapshot.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSource } from '../src/parse.js';
import { analyzeUsages } from '../src/intrinsic.js';
import { analyzePageWithAI } from '../src/ai-analyze.js';
import { computeDriftScore } from '../src/interactive.js';
import { isRealDrift } from '../src/diff.js';
import { demoSourceDefs, snapshotPath } from '../src/demo-mode.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const defs = demoSourceDefs();
  const pages = defs.map((d) => {
    const readPath = path.join(ROOT, d.src);
    const htmlPath = d.html ? path.join(ROOT, d.html) : null;
    return {
      id: d.id,
      name: d.name,
      srcFile: path.basename(readPath),
      file: path.basename(readPath),
      src: fs.readFileSync(readPath, 'utf8'),
      html: htmlPath ? fs.readFileSync(htmlPath, 'utf8') : '',
    };
  });

  const allUsages = pages.flatMap((p) => parseSource(p.src, p.srcFile));
  const { panelTokens, diffTokens, mode } = await analyzeUsages(allUsages, { figmaTokens: null });
  const apiKey = process.env.AZURE_OPENAI_API_KEY || '';

  const snapshotPages = [];
  for (const page of pages) {
    const drifts = await analyzePageWithAI({
      pageId: page.id,
      srcFile: page.srcFile,
      src: page.src,
      html: page.html,
      diffTokens,
      panelTokens,
      tokenMode: mode,
      apiKey: apiKey || undefined,
    });
    snapshotPages.push({
      id: page.id,
      name: page.name,
      file: page.srcFile,
      drifts: drifts.filter(isRealDrift).map((d, i) => ({ ...d, id: i + 1 })),
    });
  }

  const pseudoPages = snapshotPages.map((p) => ({ drifts: p.drifts }));
  const { score } = computeDriftScore(pseudoPages, panelTokens);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: apiKey ? 'ai' : 'offline',
    tokenMode: mode,
    tokens: panelTokens,
    diffTokens,
    driftScore: score,
    pages: snapshotPages,
  };

  fs.writeFileSync(snapshotPath(), JSON.stringify(snapshot, null, 2));
  const total = snapshotPages.reduce((n, p) => n + p.drifts.length, 0);
  console.log(`Wrote ${snapshotPath()} — ${total} drifts (${snapshot.source})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
