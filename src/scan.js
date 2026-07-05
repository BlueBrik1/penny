// Shared scan runner for CLI `penny scan` and agent hooks.

import fs from 'node:fs';
import path from 'node:path';

import { parseFigmaExport, fetchFigmaTokens } from './figma.js';
import { computeDriftScore } from './interactive.js';
import { loadConfig, updateConfig, resetScanState } from './config.js';
import { analyzeAllPages, resolveSourceDefs } from './pipeline.js';
import { resolveSourcePath } from './project-paths.js';

export function loadSourcePages(cfg, cssOverride = null) {
  if (cssOverride) {
    const srcPath = path.isAbsolute(cssOverride) ? cssOverride : path.join(process.cwd(), cssOverride);
    return [{ id: 'file', name: path.basename(cssOverride), file: path.basename(srcPath), path: srcPath, text: fs.readFileSync(srcPath, 'utf8'), src: fs.readFileSync(srcPath, 'utf8'), srcFile: path.basename(srcPath) }];
  }
  const defs = resolveSourceDefs(cfg);
  return defs
    .filter((d) => !(cfg.exclude || []).some((x) => x && d.src.includes(x)))
    .map((d) => {
      const srcPath = resolveSourcePath(cfg, d.src);
      const htmlPath = d.html ? resolveSourcePath(cfg, d.html) : null;
      const text = fs.readFileSync(srcPath, 'utf8');
      return {
        id: d.id,
        name: d.name,
        file: path.basename(srcPath),
        srcFile: path.basename(srcPath),
        path: srcPath,
        text,
        src: text,
        html: htmlPath ? fs.readFileSync(htmlPath, 'utf8') : '',
      };
    });
}

async function resolveFigmaBaseline(cfg, overrides = {}) {
  if (overrides['figma-export']) return parseFigmaExport(JSON.parse(fs.readFileSync(overrides['figma-export'], 'utf8')));
  const fileKey = overrides['figma-file'] || cfg.figmaFileKey || process.env.FIGMA_FILE_KEY;
  const token = overrides['figma-token'] || cfg.figmaToken || process.env.FIGMA_TOKEN;
  if (fileKey && token) return fetchFigmaTokens({ token, fileKey });
  return null;
}

/** Run a full drift scan (re-reads sources from disk). */
export async function runLocalScan(cfg, opts = {}) {
  const sources = loadSourcePages(cfg, opts.css || null);
  if (!sources.length) {
    return { via: 'rules', total: 0, delta: null, message: null, driftScore: 100, bySeverity: { high: 0, medium: 0, low: 0 }, tokenMode: 'intrinsic', tokenCount: 0, pages: [], aiLive: false, analysisMode: 'rules' };
  }
  for (const s of sources) s.text = fs.readFileSync(s.path, 'utf8'), s.src = s.text;

  const figmaBaseline = await resolveFigmaBaseline(cfg, opts);
  const { pages, panelTokens, tokenMode, aiLive, analysisMode } = await analyzeAllPages({
    pages: sources,
    cfg,
    figmaBaseline,
    opts,
  });

  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const p of pages) {
    for (const d of p.drifts) bySeverity[d.severity] = (bySeverity[d.severity] || 0) + 1;
  }

  const total = pages.reduce((n, p) => n + p.driftCount, 0);
  const { score } = computeDriftScore(pages, panelTokens);
  const prev = cfg.lastScanDriftCount;
  let delta = null;
  let message = null;
  if (prev != null && prev !== total) {
    const d = prev - total;
    delta = d;
    message = d > 0 ? `${d} drift${d !== 1 ? 's' : ''} resolved` : `${-d} new drift${-d !== 1 ? 's' : ''}`;
  }

  if (!opts.dryRun && !opts.hard) updateConfig({ lastScanDriftCount: total });

  return {
    via: aiLive ? 'ai' : 'rules',
    hard: !!opts.hard,
    total,
    delta,
    message,
    driftScore: score,
    bySeverity,
    tokenMode,
    tokenCount: panelTokens.length,
    aiLive,
    analysisMode,
    pages: pages.map((p) => ({ id: p.id, name: p.name, file: p.file, driftCount: p.driftCount, drifts: opts.verboseJson ? p.drifts : undefined })),
  };
}

/** POST /api/scan when the web dashboard is running. */
export async function runWebScan(port = 5178, path = '/api/scan') {
  const url = `http://127.0.0.1:${port}${path}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!res.ok) throw new Error(`web scan failed (${res.status})`);
  const snap = await res.json();
  const total = (snap.pages || []).reduce((n, p) => n + (p.drifts?.length || 0), 0);
  return {
    via: snap.aiLive ? 'web' : 'web',
    hard: path.includes('hard'),
    total,
    delta: snap.scanNudge?.delta ?? null,
    message: snap.scanNudge?.message ?? null,
    driftScore: snap.driftScore ?? null,
    bySeverity: countSeverities((snap.pages || []).flatMap((p) => p.drifts || [])),
    tokenMode: snap.tokenMode,
    tokenCount: snap.tokens?.length ?? 0,
    aiLive: snap.aiLive,
    pages: (snap.pages || []).map((p) => ({ id: p.id, name: p.name, file: p.srcFile, driftCount: p.drifts?.length || 0 })),
  };
}

function countSeverities(drifts) {
  const c = { high: 0, medium: 0, low: 0 };
  for (const d of drifts) c[d.severity] = (c[d.severity] || 0) + 1;
  return c;
}

export async function runLocalHardScan(cfg, opts = {}) {
  resetScanState();
  return runLocalScan(loadConfig(), { ...opts, hard: true });
}

export async function runScan(cfg, opts = {}) {
  const port = Number(opts.port || process.env.PORT || 5178);
  let result;
  const webPath = opts.hard ? '/api/hard-scan' : '/api/scan';
  if (!opts.local) {
    try {
      result = await runWebScan(port, webPath);
    } catch {
      result = opts.hard ? await runLocalHardScan(cfg, opts) : await runLocalScan(cfg, opts);
    }
  } else {
    result = opts.hard ? await runLocalHardScan(cfg, opts) : await runLocalScan(cfg, opts);
  }
  if (!opts.dryRun) updateConfig({ lastScanDriftCount: result.total });
  return result;
}

export function formatScanLines(result) {
  const sev = result.bySeverity;
  const modeTag = result.aiLive ? ' · AI' : '';
  const lines = [
    `${result.total} drift${result.total !== 1 ? 's' : ''} · ${result.driftScore ?? '—'}% aligned · ${result.tokenCount} tokens · ${result.tokenMode}${modeTag}`,
    `  ${sev.high} high · ${sev.medium} medium · ${sev.low} low`,
  ];
  if (result.hard) lines.unshift('Hard rescan — fresh AI analysis.');
  for (const p of result.pages) {
    if (p.driftCount) lines.push(`  ${p.name}: ${p.driftCount}`);
  }
  if (result.message) lines.push(result.message);
  return lines;
}
