// Central analysis router — live AI scan of configured project sources.

import { parseSource } from './parse.js';
import { analyzeUsages } from './intrinsic.js';
import { analyzePageWithAI } from './ai-analyze.js';
import { isRealDrift } from './diff.js';
import { isDismissed, dismissedItemsForPage } from './dismiss.js';
import { resolveApiKey } from './demo-mode.js';

export { resolveApiKey };

export function resolveSourceDefs(cfg) {
  if (!cfg.sources?.length) return [];
  return cfg.sources.map((s) => ({
    id: s.id,
    name: s.name || s.src,
    src: s.src,
    html: s.html,
  }));
}

export async function analyzePage({
  page,
  diffTokens,
  panelTokens,
  tokenMode,
  apiKey,
  client,
  figmaSummary = null,
  cfg = {},
}) {
  const filterOut = (drifts) => drifts.filter((d) => isRealDrift(d) && !isDismissed(page.id, d, cfg));

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
    dismissedItems: dismissedItemsForPage(page.id, cfg.dismissedItems || []),
  });
  return filterOut(drifts);
}

export async function analyzeAllPages({
  pages,
  cfg,
  figmaBaseline = null,
  client = null,
  opts = {},
}) {
  const allUsages = pages.flatMap((p) => parseSource(p.src || p.text, p.srcFile || p.file));
  const analysis = await analyzeUsages(allUsages, { figmaTokens: figmaBaseline });
  const panelTokens = analysis.panelTokens;
  const diffTokens = analysis.diffTokens;
  const tokenMode = analysis.mode;

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

  return { pages: results, panelTokens, diffTokens, tokenMode, aiLive: !!apiKey };
}
