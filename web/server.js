#!/usr/bin/env node
// Web server for the Token Drift Detector. Reuses the pipeline (figma/parse/diff/claude/
// fixer) and holds the single source of truth in memory. Serves the static page + a small
// JSON API + a Server-Sent-Events stream so all three panels hot-reload live. Stdlib http.
//
// Sources & preferences come from ~/.driftrc (see src/config.js).
//   scanMode: 'watch'   -> fs.watch each source, rescan + push on save
//   scanMode: 'interval'-> rescan every intervalMinutes, push
//   scanMode: 'ondemand'-> only rescans on POST /api/scan or /api/fix
// Live Figma: figmaFileKey + figmaToken + figmaFrameNode in config (or FIGMA_* env).
// Live AI: azureOpenAiKey in config (or AZURE_OPENAI_API_KEY).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFigmaExport, fetchFigmaTokens, fetchFigmaFrame } from '../src/figma.js';
import { parseSource } from '../src/parse.js';
import { analyzeUsages } from '../src/intrinsic.js';
import { resolveTokenFile } from '../src/token-file.js';
import { computeFixPlan, applyPlan } from '../src/fixer.js';
import { appendDismissItem, dismissedCount, recordDismissItem } from '../src/dismiss.js';
import { loadConfig, updateConfig, configExists, ensureProjectSources, shouldWatchScan, shouldIntervalScan } from '../src/config.js';
import { computeDriftScore, deepLinkCmd, webDeepLink, matchPageForElement } from '../src/interactive.js';
import { analyzePage, resolveSourceDefs, resolveApiKey } from '../src/pipeline.js';
import { detectPreviewKind, companionHtmlPath, langFromPreviewKind, resolvePreviewTarget } from '../src/preview.js';
import { resolveSourcePath, PACKAGE_ROOT, projectRoot } from '../src/project-paths.js';
import { chatCompletion, resolveLlmConfig } from '../src/llm.js';
import { freePort } from '../src/free-port.js';
import { startPreviewSidecar } from '../src/preview-sidecar.js';
import { readBootCache, writeBootCache, hydratePagesFromCache, clearBootCache } from '../src/boot-cache.js';
import { runCreativeChat, appendCreativeDrift } from '../src/creative-chat.js';

const ROOT = PACKAGE_ROOT;
const WEB = path.join(ROOT, 'web');
const FAVICONS = path.join(ROOT, 'favicons');
const FAVICON_ROUTES = {
  '/favicon.ico': 'favicon.ico',
  '/favicon-16x16.png': 'favicon-16x16.png',
  '/favicon-32x32.png': 'favicon-32x32.png',
  '/apple-touch-icon.png': 'apple-touch-icon.png',
  '/android-chrome-192x192.png': 'android-chrome-192x192.png',
  '/android-chrome-512x512.png': 'android-chrome-512x512.png',
  '/site.webmanifest': 'site.webmanifest',
};
const PORT = Number(process.env.PORT) || 5178;

const cfg = loadConfig();
const CFG = {
  export: process.env.FIGMA_EXPORT || '',
  fileKey: cfg.figmaFileKey || process.env.FIGMA_FILE_KEY,
  figmaToken: cfg.figmaToken || process.env.FIGMA_TOKEN,
  frameNode: cfg.figmaFrameNode || process.env.FIGMA_FRAME_NODE,
  figmaUrl: cfg.figmaUrl || process.env.FIGMA_URL,
  apiKey: resolveApiKey(cfg),
};

const state = {
  tokens: [],
  diffTokens: [],
  tokenMode: 'intrinsic',
  figmaBaseline: null,
  frame: null,
  pages: [],
  live: { figma: false, claude: false },
  aiLive: !!resolveApiKey(cfg),
  scanMode: cfg.scanMode,
  intervalMinutes: cfg.intervalMinutes,
  lastDriftCount: null,
  scanNudge: null,
  session: {
    focus: { pageId: null, driftIdx: 0 },
    history: [],
    historyId: 0,
  },
  pagesConfigKey: '',
  previewProxyUrl: null,
  ready: false,
  bootError: null,
};

function refreshRuntimeConfig() {
  const cur = loadConfig();
  CFG.apiKey = resolveApiKey(cur);
  state.aiLive = !!CFG.apiKey;
  state.scanMode = cur.scanMode;
  state.intervalMinutes = cur.intervalMinutes;
  return cur;
}

function pagesConfigKey() {
  const cur = refreshRuntimeConfig();
  const { kept } = sourceDefs();
  return `${projectRoot(cur)}|${kept.map((d) => `${d.id}:${d.src}:${d.html || ''}`).join('|')}`;
}

async function syncPagesFromConfig() {
  const key = pagesConfigKey();
  if (key === state.pagesConfigKey && state.pages.length) return false;
  await loadPages();
  state.pagesConfigKey = key;
  return true;
}

const figmaEmbed = (url) => `https://www.figma.com/embed?embed_host=token-drift&url=${encodeURIComponent(url)}`;

async function loadFigmaOptional() {
  state.figmaBaseline = null;
  state.live.figma = false;
  if (CFG.fileKey && CFG.figmaToken) {
    state.figmaBaseline = await fetchFigmaTokens({ token: CFG.figmaToken, fileKey: CFG.fileKey });
    state.live.figma = true;
    if (CFG.frameNode) {
      const f = await fetchFigmaFrame({ token: CFG.figmaToken, fileKey: CFG.fileKey, nodeId: CFG.frameNode });
      const url = CFG.figmaUrl || `https://www.figma.com/file/${CFG.fileKey}?node-id=${encodeURIComponent(CFG.frameNode)}`;
      state.frame = { image: f.imageUrl, embedUrl: figmaEmbed(url), frame: f.frame, nodes: f.nodes };
      return;
    }
  } else if (CFG.export && fs.existsSync(path.isAbsolute(CFG.export) ? CFG.export : path.join(ROOT, CFG.export))) {
    const exportPath = path.isAbsolute(CFG.export) ? CFG.export : path.join(ROOT, CFG.export);
    state.figmaBaseline = parseFigmaExport(JSON.parse(fs.readFileSync(exportPath, 'utf8')));
  }
}

function refreshAnalysis() {
  const cur = loadConfig();
  const allUsages = state.pages.flatMap((p) => parseSource(p.src, p.srcFile));
  const fileTokens = state.figmaBaseline ? null : resolveTokenFile(cur);
  const analysis = analyzeUsages(allUsages, { figmaTokens: state.figmaBaseline || fileTokens });
  state.tokens = analysis.panelTokens;
  state.diffTokens = analysis.diffTokens;
  state.tokenMode = fileTokens ? 'file' : analysis.mode;
}

// Resolve configured sources; excluded paths (substring match) are dropped before scanning.
function sourceDefs() {
  const cur = loadConfig();
  // aiLive = the LLM was actually available this scan (key present AND enrichment not disabled).
  state.aiLive = !!resolveApiKey(cur) && cur.enrichWithAi !== false;
  let defs = resolveSourceDefs(cur);
  const excl = cur.exclude || [];
  return { all: defs, excluded: excl, kept: defs.filter((d) => !excl.some((x) => x && d.src.includes(x))) };
}

async function recomputePage(page) {
  const cur = loadConfig();
  page.drifts = await analyzePage({
    page,
    diffTokens: state.diffTokens,
    panelTokens: state.tokens,
    tokenMode: state.tokenMode,
    apiKey: CFG.apiKey,
    figmaSummary: state.figmaBaseline ? `${state.figmaBaseline.length} Figma tokens` : null,
    cfg: cur,
  });
  state.live.claude = state.aiLive;
}

async function loadPages(fresh = false) {
  const cur = loadConfig();
  const { kept } = sourceDefs();
  const prevById = fresh ? new Map() : new Map(state.pages.map((p) => [p.id, p]));
  state.pages = [];
  for (const def of kept) {
    const readPath = resolveSourcePath(cur, def.src);
    const srcFile = path.basename(readPath);
    const original = fs.readFileSync(readPath, 'utf8');
    const writePath = readPath;
    const prev = prevById.get(def.id);
    const src = fresh ? original : (prev && prev.readPath === readPath ? prev.src : original);
    let htmlPath = def.html ? resolveSourcePath(cur, def.html) : null;
    if (!htmlPath) {
      const guess = companionHtmlPath(readPath);
      if (guess && fs.existsSync(guess)) htmlPath = guess;
    }
    const html = htmlPath && fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
    const preview = resolvePreviewTarget({
      src, srcFile, html,
      previewDevServer: cur.previewDevServer,
      previewProxyUrl: state.previewProxyUrl,
      previewUrl: def.previewUrl,
      previewPath: def.previewPath,
    });
    const page = {
      id: def.id, name: def.name, srcFile, lang: langFromPreviewKind(preview.kind), previewKind: preview.kind,
      previewUrl: preview.previewUrl, previewImportWarning: !!preview.importWarning,
      readPath, writePath, original, src, html, htmlPath, drifts: [],
    };
    state.pages.push(page);
  }
  if (!fresh) {
    const cached = readBootCache(cur);
    if (cached && hydratePagesFromCache(cur, state.pages, cached)) {
      state.tokens = cached.tokens;
      state.diffTokens = cached.diffTokens;
      state.tokenMode = cached.tokenMode;
      state.pagesConfigKey = pagesConfigKey();
      state.live.claude = state.aiLive;
      console.log('  Synced scan from cache (instant boot).');
      return;
    }
  }
  refreshAnalysis();
  for (const page of state.pages) {
    await recomputePage(page);
    if (state.scanMode === 'autonomous' && autoFix(page)) await recomputePage(page);
  }
  state.pagesConfigKey = pagesConfigKey();
  writeBootCache(cur, {
      tokens: state.tokens,
      diffTokens: state.diffTokens,
      tokenMode: state.tokenMode,
      pages: state.pages,
  });
}

/** Wipe dismissals + session memory and rerun full AI analysis from disk. */
async function hardRescan() {
  clearBootCache();
  updateConfig({ dismissed: [], dismissedItems: [], lastScanDriftCount: null });
  state.session.history = [];
  state.session.focus = { pageId: null, driftIdx: 0 };
  state.scanNudge = null;
  state.lastDriftCount = null;
  refreshRuntimeConfig();
  await loadFigmaOptional();
  await loadPages(true);
  recordScanDelta();
}

function writeSource(page, src) {
  page.src = src;
  fs.writeFileSync(page.writePath, src);
}

// Autonomous mode: apply every fixable drift on the page. Returns true if it changed the
// file (so we only write/recompute when there's actually something to fix — no loop).
function autoFix(page) {
  const fixed = applyPlan(page.src, computeFixPlan(page.src, page.drifts), null);
  if (fixed === page.src) return false;
  writeSource(page, fixed);
  return true;
}

function pushHistory(action, detail) {
  state.session.historyId += 1;
  state.session.history.unshift({
    id: state.session.historyId,
    ts: Date.now(),
    action,
    ...detail,
  });
  if (state.session.history.length > 50) state.session.history.length = 50;
}

function recordScanDelta() {
  const count = state.pages.reduce((n, p) => n + p.drifts.length, 0);
  if (state.lastDriftCount != null && count !== state.lastDriftCount) {
    const delta = state.lastDriftCount - count;
    state.scanNudge = {
      delta,
      driftCount: count,
      message: delta > 0
        ? `${delta} drift${delta !== 1 ? 's' : ''} resolved since last scan`
        : `${-delta} new drift${-delta !== 1 ? 's' : ''} detected`,
    };
  } else {
    state.scanNudge = null;
  }
  state.lastDriftCount = count;
}
const clients = new Set();
function broadcast() {
  const data = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(data);
}

// --- API ---------------------------------------------------------------------
function pageView(p) {
  return {
    id: p.id, name: p.name, srcFile: p.srcFile, lang: p.lang, previewKind: p.previewKind,
    previewUrl: p.previewUrl || null, previewImportWarning: !!p.previewImportWarning,
    readPath: p.readPath || null,
    src: p.src, html: p.html, drifts: p.drifts.filter((d) => !d.applied),
    plan: computeFixPlan(p.src, p.drifts), dirty: p.src !== p.original,
  };
}
function snapshot() {
  const cur = loadConfig();
  const { all, excluded } = sourceDefs();
  const pages = state.pages.map(pageView);
  const scoreInfo = computeDriftScore(pages, state.tokens);
  return {
    ready: state.ready,
    bootError: state.bootError,
    frame: state.frame,
    tokens: state.tokens,
    tokenMode: state.tokenMode,
    live: state.live,
    demoMode: false,
    aiLive: state.aiLive,
    analysisMode: cur.analysisMode || 'rules',
    scanMode: state.scanMode,
    tutorialComplete: !!cur.tutorialComplete,
    onboardingComplete: !!cur.onboardingComplete,
    agent: cur.agent || 'Claude Code',
    pages,
    files: all.map((d) => ({ id: d.id, name: d.name, src: d.src, excluded: excluded.some((x) => x && d.src.includes(x)) })),
    dismissed: dismissedCount(cur),
    driftScore: scoreInfo.score,
    driftStats: scoreInfo,
    scanNudge: state.scanNudge,
    focus: state.session.focus,
    history: state.session.history,
    deepLink: {
      web: webDeepLink({ pageId: state.session.focus.pageId, driftIdx: state.session.focus.driftIdx, port: PORT }),
      cli: deepLinkCmd({ pageId: state.session.focus.pageId, driftIdx: state.session.focus.driftIdx, port: PORT }),
    },
  };
}

async function handleApi(req, res, url, body) {
  const send = (obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send({ ok: !state.bootError, ready: state.ready, error: state.bootError });
  }

  await bootPromise;
  if (state.bootError) {
    return send({ error: state.bootError, onboardingComplete: configExists(), pages: [] }, 503);
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    await syncPagesFromConfig();
    return send(snapshot());
  }

  // On-demand rescan (re-read tokens + sources, re-diff every page).
  if (req.method === 'POST' && url.pathname === '/api/scan') {
    await syncPagesFromConfig();
    await loadFigmaOptional();
    refreshAnalysis();
    for (const p of state.pages) {
      p.src = fs.readFileSync(p.readPath, 'utf8');
      if (p.htmlPath) p.html = fs.readFileSync(p.htmlPath, 'utf8');
      await recomputePage(p);
    }
    recordScanDelta();
    broadcast();
    writeBootCache(loadConfig(), {
      tokens: state.tokens,
      diffTokens: state.diffTokens,
      tokenMode: state.tokenMode,
      pages: state.pages,
    });
    return send(snapshot());
  }

  // Hard rescan — clear dismissals/history and rerun AI as if first visit.
  if (req.method === 'POST' && url.pathname === '/api/hard-scan') {
    await syncPagesFromConfig();
    try {
      await hardRescan();
    } catch (e) {
      broadcast();
      return send({ ...snapshot(), error: e.message }, 500);
    }
    broadcast();
    return send(snapshot());
  }

  // Dismiss one suggestion (persist its stable key) — instant, no rescan.
  if (req.method === 'POST' && url.pathname === '/api/dismiss') {
    const page = state.pages.find((p) => p.id === body.pageId) || state.pages[0];
    const d = page?.drifts.find((x) => x.id === body.driftId);
    if (d) {
      const cur = loadConfig();
      const item = recordDismissItem(page.id, d);
      updateConfig({ dismissedItems: appendDismissItem(cur, item) });
      page.drifts = page.drifts.filter((x) => x.id !== d.id).map((x, i) => ({ ...x, id: i + 1 }));
      pushHistory('dismiss', { pageId: page.id, driftId: d.id, token: d.token?.name, element: item.elementName || item.element });
      recordScanDelta();
      broadcast();
    }
    return send(snapshot());
  }

  // Restore all dismissed suggestions.
  if (req.method === 'POST' && url.pathname === '/api/restore') {
    updateConfig({ dismissed: [], dismissedItems: [] });
    for (const p of state.pages) await recomputePage(p);
    broadcast();
    return send(snapshot());
  }

  // Apply fixes to one page. ids omitted -> all fixable; ids given -> just those drifts.
  // Optional overrides: { driftId: { line: afterText } } for inline edit.
  if (req.method === 'POST' && url.pathname === '/api/fix') {
    const page = state.pages.find((p) => p.id === body.pageId) || state.pages[0];
    let plan = computeFixPlan(page.src, page.drifts);
    const overrides = body.overrides || {};
    if (Object.keys(overrides).length) {
      plan = plan.map((item) => ({
        ...item,
        edits: item.edits.map((e) => {
          const ov = overrides[item.id]?.[e.line];
          return ov != null ? { ...e, override: ov, after: ov } : e;
        }),
      }));
    }
    const ids = Array.isArray(body.ids) ? body.ids : null;
    const before = page.drifts.length;
    const fixedSrc = applyPlan(page.src, plan, ids);
    const fixUnchanged = fixedSrc === page.src;
    if (!fixUnchanged) writeSource(page, fixedSrc);
    refreshAnalysis();
    if (!fixUnchanged) await recomputePage(page);
    else {
      // Drop drifts that were in the apply request even if the line didn't change (stale edit).
      const appliedIds = new Set(ids || plan.map((p) => p.id));
      page.drifts = page.drifts.filter((d) => !appliedIds.has(d.id)).map((d, i) => ({ ...d, id: i + 1 }));
    }
    pushHistory('fix', { pageId: page.id, pageName: page.name, ids: ids || plan.map((p) => p.id), before, after: page.drifts.length });
    recordScanDelta();
    broadcast();
    return send({ ...snapshot(), fixUnchanged });
  }

  if (req.method === 'POST' && url.pathname === '/api/revert') {
    const page = state.pages.find((p) => p.id === body.pageId) || state.pages[0];
    writeSource(page, page.original);
    refreshAnalysis();
    for (const p of state.pages) await recomputePage(p);
    pushHistory('revert', { pageId: page.id, pageName: page.name });
    recordScanDelta();
    broadcast();
    return send(snapshot());
  }

  if (req.method === 'POST' && url.pathname === '/api/revert-all') {
    for (const page of state.pages) {
      if (page.src !== page.original) writeSource(page, page.original);
    }
    refreshAnalysis();
    for (const p of state.pages) await recomputePage(p);
    pushHistory('revert-all', {});
    recordScanDelta();
    broadcast();
    return send(snapshot());
  }

  // Sync focus across CLI/web clients.
  if (req.method === 'POST' && url.pathname === '/api/focus') {
    if (body.pageId != null) state.session.focus.pageId = body.pageId;
    if (typeof body.driftIdx === 'number') state.session.focus.driftIdx = body.driftIdx;
    broadcast();
    return send(snapshot());
  }

  // Non-technical mode chat — plain language + optional drift/fix generation.
  if (req.method === 'POST' && url.pathname === '/api/creative-chat') {
    const page = state.pages.find((p) => p.id === body.pageId) || state.pages[0];
    if (!page) return send({ error: 'page not found', pages: [] }, 404);
    if (body.element) {
      const { matched } = matchPageForElement(state.pages, body.element, page.id);
      if (!matched) {
        return send({
          ...snapshot(),
          creativeReply: 'Could not match this element to a source file — try clicking again or switch tabs manually.',
          creativeDriftId: null,
        });
      }
    }
    const cur = loadConfig();
    try {
      const { reply, drift } = await runCreativeChat({
        page,
        element: body.element || null,
        message: body.message || '',
        history: body.history || [],
        panelTokens: state.tokens,
        tokenMode: state.tokenMode,
        figmaSummary: state.figmaBaseline ? `${state.figmaBaseline.length} Figma tokens` : null,
        cfg: cur,
        apiKey: CFG.apiKey,
      });
      let creativeDriftId = null;
      if (drift) {
        creativeDriftId = appendCreativeDrift(page, drift);
        if (creativeDriftId) {
          const driftIdx = page.drifts.findIndex((d) => d.id === creativeDriftId);
          state.session.focus = { pageId: page.id, driftIdx: Math.max(0, driftIdx) };
          pushHistory('creative-fix', { pageId: page.id, pageName: page.name, driftId: creativeDriftId });
          recordScanDelta();
        }
      }
      broadcast();
      return send({ ...snapshot(), creativeReply: reply, creativeDriftId, creativePageId: page.id });
    } catch (e) {
      return send({ ...snapshot(), error: e.message, creativeReply: `Sorry — ${e.message}` }, 500);
    }
  }

  // Agent chat for current drift.
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const page = state.pages.find((p) => p.id === body.pageId) || state.pages[0];
    const d = page?.drifts.find((x) => x.id === body.driftId);
    if (!d) return send({ error: 'drift not found' }, 404);
    const prompt = body.message || 'Explain this drift and suggest the best fix.';
    const excerpt = page.src.split('\n').slice(Math.max(0, (d.locations[0]?.line || 1) - 3), (d.locations[0]?.line || 1) + 2).join('\n');
    const ctx = `Drift on ${page.srcFile}:\n${JSON.stringify({ category: d.category, severity: d.severity, token: d.token?.name, expected: d.expected, actual: d.actualValues, why: d.why, fix: d.fix, locations: d.locations.slice(0, 6) }, null, 2)}\n\nSource excerpt:\n${excerpt}`;
    if (!CFG.apiKey) {
      return send({ reply: `${d.problem || d.why || 'Token drift detected.'}\n\nSuggested fix: ${d.solution || d.fix || 'Align with the design token.'}`, offline: true });
    }
    try {
      const llmCfg = resolveLlmConfig(loadConfig());
      const reply = await chatCompletion({
        ...llmCfg,
        apiKey: CFG.apiKey,
        system: 'You are Penny, a design-token drift coach. Be concise. Explain why the drift matters and give a concrete fix.',
        messages: [{ role: 'user', content: `${ctx}\n\nUser: ${prompt}` }],
        maxTokens: 1024,
      });
      return send({ reply });
    } catch (e) {
      return send({ error: e.message, reply: d.fix || d.why || 'Unable to reach Azure OpenAI.' }, 500);
    }
  }

  // Toggle a file/path in the persisted exclusion list, then rebuild the page set.
  if (req.method === 'POST' && url.pathname === '/api/exclude') {
    const cur = loadConfig();
    const set = new Set(cur.exclude || []);
    if (set.has(body.path)) set.delete(body.path); else set.add(body.path);
    updateConfig({ exclude: [...set] });
    await loadPages();
    broadcast();
    return send(snapshot());
  }

  // Persist UI preferences.
  if (req.method === 'POST' && url.pathname === '/api/config') {
    const patch = {};
    if (typeof body.tutorialComplete === 'boolean') patch.tutorialComplete = body.tutorialComplete;
    if (typeof body.onboardingComplete === 'boolean') patch.onboardingComplete = body.onboardingComplete;
    if (Object.keys(patch).length) updateConfig(patch);
    broadcast();
    return send(snapshot());
  }

  return send({ error: 'not found' }, 404);
}

// --- static ------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4' };
function serveStatic(req, res, url) {
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  let file;
  const faviconName = FAVICON_ROUTES[rel];
  if (faviconName) file = path.join(FAVICONS, faviconName);
  else if (rel.startsWith('/favicons/')) file = path.normalize(path.join(FAVICONS, rel.slice('/favicons/'.length)));
  else if (rel.startsWith('/shared/')) file = path.normalize(path.join(ROOT, 'src', rel.slice('/shared/'.length)));
  else {
    const base = rel.startsWith('/fonts/') ? ROOT : WEB;
    file = path.normalize(path.join(base, rel));
  }
  const okRoot = file.startsWith(WEB) || file.startsWith(path.join(ROOT, 'fonts')) || file.startsWith(FAVICONS) || file.startsWith(path.join(ROOT, 'src'));
  if (!okRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  // No caching for the app shell/JS so edits always show without a hard refresh.
  const noStore = /\.(jsx|html|js)$/.test(file);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...(noStore ? { 'Cache-Control': 'no-store' } : {}) });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.add(res);
    bootPromise.then(() => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    });
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let b = {};
      try { b = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
      try { await handleApi(req, res, url, b); }
      catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  serveStatic(req, res, url);
});

// --- watch / interval scanning ------------------------------------------------
function startScanning() {
  // 'watch' rescans on save; 'autonomous' also auto-applies every fixable drift.
  // Callbacks re-read scanMode so a mode switch in ~/.driftrc stops stray rescans without restart.
  if (shouldWatchScan(loadConfig())) {
    let t = null;
    const rescan = (page) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        refreshRuntimeConfig();
        const cur = loadConfig();
        if (!shouldWatchScan(cur)) return;
        try {
          page.src = fs.readFileSync(page.readPath, 'utf8');
          refreshAnalysis();
          await recomputePage(page);
          if (cur.scanMode === 'autonomous' && autoFix(page)) await recomputePage(page);
          recordScanDelta();
          broadcast();
        } catch { /* file mid-write; next event covers it */ }
      }, 150); // debounce editor save bursts
    };
    // watchFile (stat polling) rather than fs.watch: it survives atomic saves
    // (write-temp-then-rename), which editors and tools use and which break fs.watch.
    for (const p of state.pages) {
      try { fs.watchFile(p.readPath, { interval: 400 }, (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs) rescan(p); }); }
      catch { /* unwatchable path */ }
    }
  } else if (shouldIntervalScan(loadConfig())) {
    setInterval(async () => {
      refreshRuntimeConfig();
      if (!shouldIntervalScan(loadConfig())) return;
      if (state.live.figma) await loadFigmaOptional();
      refreshAnalysis();
      for (const p of state.pages) {
        p.src = fs.readFileSync(p.readPath, 'utf8');
        if (p.htmlPath) p.html = fs.readFileSync(p.htmlPath, 'utf8');
      }
      refreshAnalysis();
      for (const p of state.pages) await recomputePage(p);
      recordScanDelta();
      broadcast();
    }, Math.max(1, state.intervalMinutes) * 60_000);
  }
}

async function boot() {
  ensureProjectSources(loadConfig());
  const cur = loadConfig();
  if (cur.previewDevServer) {
    try {
      const sidecar = await startPreviewSidecar(
        cur.previewDevServer,
        `http://127.0.0.1:${PORT}/penny-bridge.js`,
      );
      state.previewProxyUrl = sidecar.url;
      process.on('exit', () => sidecar.close());
      console.log(`  Preview proxy → ${sidecar.url} → ${cur.previewDevServer}`);
    } catch (e) {
      console.warn(`  Preview proxy failed (${e.message}) — iframe will use dev server directly.`);
    }
  }
  await loadFigmaOptional();
  await loadPages();
  state.lastDriftCount = state.pages.reduce((n, p) => n + p.drifts.length, 0);
  startScanning();
  state.ready = true;
  broadcast();
}

const bootPromise = boot().catch((e) => {
  state.bootError = e.message;
  console.error('\x1b[31mStartup failed:\x1b[0m', e.message);
});

freePort(PORT);
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\x1b[31mPort ${PORT} is already in use.\x1b[0m`);
    console.error(`  Another Penny instance may still be running — open http://127.0.0.1:${PORT}`);
    console.error(`  Or use a different port:  $env:PORT=5179; npm run web   (PowerShell)`);
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, () => {
  console.log(`\x1b[36mPenny\x1b[0m → http://127.0.0.1:${PORT}`);
  console.log('  Loading pages…');
  bootPromise.then(() => {
    if (!state.ready) return;
    const mode = state.aiLive ? 'Azure OpenAI' : 'offline';
    console.log(`  pages: ${state.pages.map((p) => p.srcFile).join(', ')}  |  baseline: ${state.tokenMode}  |  ${mode}  |  scan: ${state.scanMode}`);
  });
});
