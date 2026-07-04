// Central analysis router — live AI vs demo snapshot.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSource } from './parse.js';
import { analyzeUsages } from './intrinsic.js';
import { analyzePageWithAI } from './ai-analyze.js';
import { isRealDrift } from './diff.js';
import { driftKey } from './fixer.js';
import {
  isDemoMode, resolveApiKey, loadDemoSnapshot, demoDriftsForPage,
  demoTokens, demoTokenMode, demoSourceDefs,
} from './demo-mode.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export { isDemoMode, resolveApiKey, demoSourceDefs };

export function resolveSourceDefs(cfg) {
  if (isDemoMode(cfg)) return demoSourceDefs();
  if (cfg.sources?.length) {
    return cfg.sources.map((s) => ({
      id: s.id,
      name: s.name || path.basename(s.src),
      src: s.src,
      html: s.html,
      seed: false,
    }));
  }
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed/pages.json'), 'utf8'));
  return seed.map((p) => ({ id: p.id, name: p.name, src: p.css, html: p.html, seed: true }));
}

export async function analyzePage({
  page,
  diffTokens,
  panelTokens,
  tokenMode,
  apiKey,
  client,
  figmaSummary = null,
  dismissed = new Set(),
  demoSnapshot = null,
  cfg = {},
}) {
  if (isDemoMode(cfg)) {
    const snap = demoSnapshot || loadDemoSnapshot();
    const drifts = demoDriftsForPage(page.id, snap)
      .filter((d) => isRealDrift(d) && !dismissed.has(driftKey(d)));
    return drifts;
  }

  const drifts = await analyzePageWithAI({
    pageId: page.id,
    srcFile: page.srcFile || page.file,
    src: page.src || page.text,
    html: page.html || '',
    diffTokens,
    panelTokens,
    tokenMode,
    figmaSummary,
    apiKey: apiKey || resolveApiKey(cfg),
    cfg,
    client,
  });
  return drifts.filter((d) => isRealDrift(d) && !dismissed.has(driftKey(d)));
}

export async function analyzeAllPages({
  pages,
  cfg,
  figmaBaseline = null,
  client = null,
  opts = {},
}) {
  const demo = isDemoMode(cfg);
  const snap = demo ? loadDemoSnapshot() : null;

  let panelTokens, diffTokens, tokenMode;
  if (demo && snap?.tokens?.length) {
    panelTokens = snap.tokens;
    diffTokens = snap.diffTokens || snap.tokens;
    tokenMode = demoTokenMode(snap);
  } else {
    const allUsages = pages.flatMap((p) => parseSource(p.src || p.text, p.srcFile || p.file));
    const analysis = await analyzeUsages(allUsages, { figmaTokens: figmaBaseline });
    panelTokens = analysis.panelTokens;
    diffTokens = analysis.diffTokens;
    tokenMode = analysis.mode;
  }

  const dismissed = new Set(cfg.dismissed || []);
  const apiKey = resolveApiKey(cfg);
  const figmaSummary = figmaBaseline
    ? `${figmaBaseline.length || 0} Figma tokens loaded`
    : null;

  const results = [];
  for (const page of pages) {
    const drifts = await analyzePage({
      page,
      diffTokens,
      panelTokens,
      tokenMode,
      apiKey,
      client,
      figmaSummary,
      dismissed,
      demoSnapshot: snap,
      cfg,
    });
    results.push({
      id: page.id,
      name: page.name,
      file: page.srcFile || page.file,
      driftCount: drifts.length,
      drifts,
    });
  }

  return { pages: results, panelTokens, diffTokens, tokenMode, demoMode: demo, aiLive: !demo && !!apiKey };
}
