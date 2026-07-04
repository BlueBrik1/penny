// Shared scan cache so CLI ↔ web reuse the first boot (skip duplicate AI passes).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveSourceDefs } from './pipeline.js';
import { companionHtmlPath } from './preview.js';
import { projectRoot, resolveSourcePath } from './project-paths.js';

export function bootCachePath() {
  const rc = process.env.DRIFTRC || path.join(os.homedir(), '.driftrc');
  return process.env.DRIFT_CACHE || path.join(path.dirname(rc), '.driftcache.json');
}

function fileSig(p) {
  if (!p) return null;
  try {
    const st = fs.statSync(p);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
}

function pageFileSigs(cfg, def) {
  const readPath = resolveSourcePath(cfg, def.src);
  let htmlPath = def.html ? resolveSourcePath(cfg, def.html) : null;
  if (!htmlPath && readPath) {
    const guess = companionHtmlPath(readPath);
    if (guess && fs.existsSync(guess)) htmlPath = guess;
  }
  return { readSig: fileSig(readPath), htmlSig: htmlPath ? fileSig(htmlPath) : null };
}

/** Stable key for current sources. */
export function buildScanKey(cfg) {
  const defs = resolveSourceDefs(cfg);
  const excl = (cfg.exclude || []).join(',');
  return `${projectRoot(cfg)}|${excl}|${defs.map((d) => `${d.id}:${d.src}:${d.html || ''}`).join('|')}`;
}

function pageDefs(cfg) {
  return resolveSourceDefs(cfg);
}

function sigsMatch(stored, cfg, def) {
  const live = pageFileSigs(cfg, def);
  if (!stored || stored.readSig !== live.readSig) return false;
  if ((stored.htmlSig || null) !== (live.htmlSig || null)) return false;
  return true;
}

export function readBootCache(cfg) {
  try {
    const raw = JSON.parse(fs.readFileSync(bootCachePath(), 'utf8'));
    if (raw.key !== buildScanKey(cfg)) return null;
    const defs = pageDefs(cfg);
    if (!raw.pages?.length || raw.pages.length !== defs.length) return null;
    for (const def of defs) {
      const cp = raw.pages.find((p) => p.id === def.id);
      if (!cp || !sigsMatch(cp.files, cfg, def)) return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function writeBootCache(cfg, { tokens, diffTokens, tokenMode, pages }) {
  const defs = pageDefs(cfg);
  const byId = new Map((pages || []).map((p) => [p.id, p]));
  const payload = {
    key: buildScanKey(cfg),
    at: Date.now(),
    tokens,
    diffTokens,
    tokenMode,
    pages: defs.map((def) => ({
      id: def.id,
      drifts: byId.get(def.id)?.drifts || [],
      files: pageFileSigs(cfg, def),
    })),
  };
  try {
    fs.writeFileSync(bootCachePath(), JSON.stringify(payload));
  } catch { /* ignore */ }
}

export function clearBootCache() {
  try { fs.unlinkSync(bootCachePath()); } catch { /* ignore */ }
}

/** Apply cached drifts/tokens to in-memory page list; returns true when fully hydrated. */
export function hydratePagesFromCache(cfg, pages, cache) {
  if (!cache?.pages?.length) return false;
  const defs = pageDefs(cfg);
  if (defs.length !== pages.length) return false;
  for (const def of defs) {
    const cp = cache.pages.find((p) => p.id === def.id);
    const page = pages.find((p) => p.id === def.id);
    if (!cp || !page || !sigsMatch(cp.files, cfg, def)) return false;
    page.drifts = cp.drifts || [];
  }
  return true;
}

export function cacheToAnalysis(cached, sources) {
  const byId = new Map(cached.pages.map((p) => [p.id, p]));
  return {
    panelTokens: cached.tokens || [],
    diffTokens: cached.diffTokens || cached.tokens || [],
    tokenMode: cached.tokenMode || 'intrinsic',
    pages: sources.map((p) => ({
      id: p.id,
      name: p.name,
      file: p.srcFile || p.file,
      driftCount: (byId.get(p.id)?.drifts || []).length,
      drifts: byId.get(p.id)?.drifts || [],
    })),
  };
}
