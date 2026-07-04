// Connect CLI/TUI to the running web dashboard (shared session in live mode).

import http from 'node:http';

import { loadConfig } from './config.js';
import { resolveSourcePath } from './project-paths.js';

const DEFAULT_PORT = Number(process.env.PORT) || 5178;

export async function isWebAvailable(port = DEFAULT_PORT) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Poll until the web server accepts connections (may still be loading pages). */
export async function waitForWebServer(port = DEFAULT_PORT, maxMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await isWebAvailable(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

export async function fetchWebHealth(port = DEFAULT_PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`web health failed (${res.status})`);
  return res.json();
}

/** Poll /api/health until the dashboard finishes its first boot. */
export async function waitForWebReady(port = DEFAULT_PORT, maxMs = 300_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const h = await fetchWebHealth(port);
      if (h.ready) return h;
      if (h.error) throw new Error(h.error);
    } catch (e) {
      if (!(await isWebAvailable(port))) throw e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Timed out waiting for web dashboard');
}

export async function fetchWebState(port = DEFAULT_PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/api/state`);
  if (!res.ok) throw new Error(`web state failed (${res.status})`);
  return res.json();
}

export async function webPost(port, path, body = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`web ${path} failed (${res.status})`);
  return res.json();
}

/** Resolve on-disk path for a web page entry. */
function resolvePagePath(wp, local, cfg) {
  if (local?.path) return local.path;
  if (local?.readPath) return local.readPath;
  if (wp.readPath) return wp.readPath;
  const def = (cfg.sources || []).find((s) => s.id === wp.id);
  if (def?.src) return resolveSourcePath(cfg, def.src);
  return null;
}

/** Map web snapshot + local file paths into TUI state. */
export function snapshotToTui(snap, sources = [], cfg = null) {
  const cur = cfg || loadConfig();
  const byId = new Map(sources.map((s) => [s.id, s]));
  const pages = (snap.pages || []).map((wp) => {
    const local = byId.get(wp.id);
    const filePath = resolvePagePath(wp, local, cur);
    return {
      id: wp.id,
      name: wp.name,
      file: wp.srcFile,
      srcFile: wp.srcFile,
      path: filePath,
      // Prefer disk in TUI — web snapshot src can be stale or truncated during SSE.
      text: filePath ? undefined : wp.src,
      src: filePath ? undefined : wp.src,
      html: wp.html || '',
    };
  });

  const problems = [];
  for (const wp of snap.pages || []) {
    const page = pages.find((p) => p.id === wp.id);
    if (!page) continue;
    for (const d of wp.drifts || []) problems.push({ page, drift: d });
  }

  return {
    pages,
    problems,
    tokens: snap.tokens || [],
    tokenMode: snap.tokenMode || 'intrinsic',
    demoMode: !!snap.demoMode,
    aiLive: !!snap.aiLive,
  };
}

/** Subscribe to server SSE; returns unsubscribe. */
export function subscribeWebEvents(port, onSnapshot) {
  let req;
  try {
    req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/events',
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    }, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString();
        let sep;
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const m = block.match(/^data: (.+)$/m);
          if (m) {
            try { onSnapshot(JSON.parse(m[1])); } catch { /* ignore malformed */ }
          }
        }
      });
    });
    req.on('error', () => {});
    req.end();
  } catch { /* ignore */ }

  return () => { try { req?.destroy(); } catch { /* ignore */ } };
}

export function webHardScan(port = DEFAULT_PORT) {
  return webPost(port, '/api/hard-scan', {});
}

export function applySnapshotToTui(snap, sources, prev = {}) {
  const next = snapshotToTui(snap, sources);
  const curPageId = prev.pages?.[prev.curPage]?.id;
  let curPage = curPageId != null ? next.pages.findIndex((p) => p.id === curPageId) : 0;
  if (curPage < 0) curPage = 0;
  const curDriftId = prev.problems?.[prev.idx]?.drift?.id;
  const page = next.pages[curPage];
  const pageProblems = next.problems.filter((p) => p.page.id === page?.id);
  let idx = curDriftId != null
    ? pageProblems.findIndex((p) => p.drift.id === curDriftId)
    : Math.min(prev.idx ?? 0, Math.max(0, pageProblems.length - 1));
  if (idx < 0) idx = Math.max(0, pageProblems.length - 1);
  return { ...next, curPage, idx };
}
