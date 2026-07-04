import React, { useState, useEffect, useMemo, useRef, useCallback } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import {
  groupDrifts, spotlightSelectorsFromDrift, hasApplicableEdits, highlightLocations,
} from '/shared/interactive.js';
import { collectMapMarkers, renderMapInIframe, clearMapInIframe, scrollDriftIntoView } from '/shared/drift-map.js';
import { buildPreviewDocument, previewSandbox, previewKindLabel, detectPreviewKind, buildPulseCss, PREVIEW_KIND } from '/shared/preview.js';

async function apiPost(path, body = {}) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!Array.isArray(data.pages)) {
    const hint = r.status === 404 ? ' Restart with `penny view` to load the latest server.' : '';
    throw new Error((data.error || `Request failed (${r.status})`) + hint);
  }
  if (!r.ok && data.error) {
    const err = new Error(data.error);
    err.snapshot = data;
    throw err;
  }
  return data;
}
async function apiGetState() {
  const r = await fetch('/api/state');
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(data.pages)) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
const api = {
  state: apiGetState,
  scan: () => apiPost('/api/scan'),
  hardScan: () => apiPost('/api/hard-scan'),
  fix: (pageId, ids, overrides) => apiPost('/api/fix', { pageId, ids, overrides }),
  revert: (pageId) => apiPost('/api/revert', { pageId }),
  revertAll: () => apiPost('/api/revert-all'),
  exclude: (path) => apiPost('/api/exclude', { path }),
  dismiss: (pageId, driftId) => apiPost('/api/dismiss', { pageId, driftId }),
  restore: () => apiPost('/api/restore'),
  config: (patch) => apiPost('/api/config', patch),
  focus: (pageId, driftIdx) => apiPost('/api/focus', { pageId, driftIdx }),
};

const PAPER = '237,233,223';
const paper = (a = 1) => `rgba(${PAPER},${a})`;
const RANK = { high: 3, medium: 2, low: 1 };
const SEVCOLOR = { high: '#e5484d', medium: '#f5a623', low: '#4c9be8' };
const CODE = { comment: '#6f6a60', string: '#b6c99a', color: '#cf9bd6', number: '#d3a06a', selector: '#dab26a', property: '#8fb7dc', value: '#b6c99a', punct: '#7d786e', plain: '#ede9df' };
const DIFF = { rmBg: 'rgba(255,90,90,0.15)', rmFg: '#ff8a8a', addBg: 'rgba(96,196,128,0.15)', addFg: '#82d69a', appliedBg: 'rgba(96,196,128,0.35)', appliedBorder: '#82d69a' };
const TUTORIAL_STORAGE = 'penny-tutorial-done';

const qs = () => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
const urlTutorial = () => qs().get('tutorial') === '1';
const urlDrift = () => { const d = qs().get('drift'); return d != null && d !== '' ? parseInt(d, 10) : null; };
const urlPage = () => qs().get('page');

const TUTORIAL_STEPS = [
  { target: null, title: 'Welcome to Penny', body: 'Penny finds inconsistent colors, spacing, and typography in your CSS and JSX — no Figma file required. This quick tour walks you through the dashboard.' },
  { target: '[data-tutorial="summary"]', title: 'Scan summary', body: 'Drift counts by severity. Filter HIGH / MEDIUM / LOW, toggle Group or Map on the right, rescan sources, or open the raw Figma file.', placement: 'bottom' },
  { target: '[data-tutorial="preview"]', title: 'Live preview', body: 'Your page rendered with the current CSS. Affected selectors highlight when you select a drift.', placement: 'right' },
  { target: '[data-tutorial="preview"]', title: 'Drift map', body: 'Map overlays severity-colored outlines on every drifted element in the preview — red for high, amber for medium, blue for low. Toggle it from the summary bar or press M. Select a problem to focus the map on that issue only.', placement: 'right', demo: 'map' },
  { target: '[data-tutorial="problems"]', title: 'Group by token', body: 'Group collapses drifts that share the same value family into one cluster — five splintered brand oranges become a single fixable problem. Toggle Group in the summary bar or press G, then use Fix group to apply the whole cluster at once.', placement: 'left', demo: 'group' },
  { target: '[data-tutorial="tokens"]', title: 'Code tokens', body: 'Every color, spacing, and type value Penny finds in your source. Dimmed rows are consistent; bright rows tie to a drift — click to jump.', placement: 'left' },
  { target: '[data-tutorial="problems"]', title: 'Drift details', body: 'Step through problems with ↑↓. Comparison cinema shows Design vs Shipped for colors and sizes.', placement: 'left' },
  { target: '[data-tutorial="code"]', title: 'Source code', body: 'The file behind the preview. Drift lines are marked; fix preview shows proposed edits inline.', placement: 'left' },
  { target: '[data-tutorial="fix"]', title: 'Fix mode', body: 'Apply one fix or batch-apply all. Ask your agent copies a prompt to your clipboard.', placement: 'top' },
  { target: null, title: "You're ready", body: 'Explore drifts on your own — try Group (G) and Map (M) anytime. Reopen this tour from Tutorial in the summary bar.', placement: 'bottom' },
];

const RULES = [
  ['comment', /^\/\*[\s\S]*?\*\/|^\/\/.*/], ['string', /^"[^"]*"|^'[^']*'|^`[^`]*`/],
  ['color', /^#[0-9a-fA-F]{3,8}\b/], ['number', /^-?\d*\.?\d+(?:px|rem|em|%|deg|s|ms)?\b/],
  ['selector', /^::?[A-Za-z-][\w-]*/], ['property', /^-{0,2}[A-Za-z][\w-]*(?=\s*:)/],
  ['punct', /^[{}()<>;:,/=]/], ['value', /^[A-Za-z_][\w-]*/], ['space', /^\s+/],
];
function tokenize(line) {
  const out = []; let s = line;
  while (s.length) {
    let hit = false;
    for (const [c, re] of RULES) { const m = re.exec(s); if (m) { out.push({ c, t: m[0] }); s = s.slice(m[0].length); hit = true; break; } }
    if (!hit) { out.push({ c: 'plain', t: s[0] }); s = s.slice(1); }
  }
  return out;
}
function Code({ text }) {
  return <>{tokenize(text).map((tk, i) => <span key={i} style={{ color: CODE[tk.c] || CODE.plain, whiteSpace: 'pre', fontStyle: tk.c === 'comment' ? 'italic' : 'normal' }}>{tk.t}</span>)}</>;
}

function Win({ title, right, children, className = '', style = {} }) {
  return (
    <div className={`rounded-xl overflow-hidden flex flex-col ${className}`} style={{ border: `1px solid ${paper(0.14)}`, ...style }}>
      <div className="text-[11px] px-3 py-1.5 shrink-0 flex items-center justify-between" style={{ color: paper(0.5), borderBottom: `1px solid ${paper(0.1)}` }}>
        <span>{title}</span>{right}
      </div>
      {children}
    </div>
  );
}
function Swatch({ value, size = 14 }) {
  if (!value || !/^#|^rgb/.test(value)) return null;
  return <span className="inline-block rounded-sm align-middle shrink-0" style={{ width: size, height: size, background: value, border: `1px solid ${paper(0.35)}` }} />;
}
function TokenGlyph({ t, size = 14 }) {
  if (t.type === 'color') return <Swatch value={t.color || t.value} size={size} />;
  const box = { width: size, height: size, border: `1px solid ${paper(0.35)}`, background: paper(0.08) };
  if (t.type === 'typography') {
    return <span className="inline-flex items-center justify-center rounded-sm align-middle shrink-0 mono text-[9px] font-bold" style={{ ...box, color: paper(0.7) }}>Aa</span>;
  }
  if (t.type === 'spacing') {
    return <span className="inline-flex items-center justify-center rounded-sm align-middle shrink-0 mono text-[8px]" style={{ ...box, color: paper(0.55) }}>{t.px ?? '·'}</span>;
  }
  return null;
}
function Chip({ type, value }) {
  return <span className="inline-flex items-center gap-1.5 mr-2 mb-1 px-1.5 py-0.5 rounded" style={{ background: paper(0.06) }}>{type === 'color' && <Swatch value={value} />}<code className="mono text-[12px]">{value}</code></span>;
}

function countSeverities(drifts) {
  const c = { high: 0, medium: 0, low: 0 };
  for (const d of drifts) c[d.severity] = (c[d.severity] || 0) + 1;
  return c;
}

function SummaryBar({ drifts, sevFilter, onFilter, onRescan, onHardRescan, onFigma, onTutorial, busy, driftScore, scanNudge, groupMode, onGroup, heatmapOn, onHeatmap, tokenCount, tokenMode, scanMode, demoMode, aiLive, onCopyCli, onShortcuts }) {
  const sev = countSeverities(drifts);
  const ghost = { border: `1px solid ${paper(0.3)}`, color: paper(0.9) };
  const chip = (s) => ({
    border: `1px solid ${sevFilter === s ? SEVCOLOR[s] : paper(0.2)}`,
    color: sevFilter === s ? SEVCOLOR[s] : paper(0.55),
    background: sevFilter === s ? `${SEVCOLOR[s]}22` : paper(0.04),
  });
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 w-full px-3 py-2 rounded-lg" style={{ border: `1px solid ${paper(0.12)}`, background: paper(0.03) }}>
      <img src="/logo.png" alt="penny" className="h-7 w-auto shrink-0 mr-1" style={{ mixBlendMode: 'screen' }} />
      <button type="button" onClick={onCopyCli} className="text-[10px] px-2 py-0.5 rounded mono shrink-0" style={{ border: `1px solid ${paper(0.15)}`, color: paper(0.45) }} title="Copy CLI deep link">CLI</button>
      <button type="button" onClick={onShortcuts} className="text-[10px] px-2 py-0.5 rounded shrink-0" style={{ border: `1px solid ${paper(0.15)}`, color: paper(0.45) }} title="Keyboard shortcuts">h</button>
      <span className="w-px h-5 shrink-0 mx-0.5" style={{ background: paper(0.15) }} aria-hidden="true" />
      <span className="text-sm font-medium shrink-0" style={{ color: paper(0.85) }}>{drifts.length} drift{drifts.length !== 1 ? 's' : ''}</span>
      <span className="text-xs px-2 py-0.5 rounded shrink-0" style={{ background: paper(0.06), color: paper(0.7) }} title="Token adherence">{driftScore ?? '—'}% aligned</span>
      <span className="text-[11px] shrink-0" style={{ color: paper(0.4) }}>{tokenCount ?? 0} found · {tokenMode === 'figma' ? 'figma' : 'code'} · scan {scanMode ?? '—'}</span>
      {demoMode && <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0" style={{ background: '#f5a62322', color: '#f5a623', border: '1px solid #f5a62344' }} title="Bundled seed demo — add API key in penny onboarding">demo</span>}
      {aiLive && !demoMode && <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0" style={{ background: '#82d69a22', color: '#82d69a', border: '1px solid #82d69a44' }} title="Live AI analysis">AI</span>}
      {scanNudge && <span className="text-xs shrink-0" style={{ color: scanNudge.delta > 0 ? '#82d69a' : '#f5a623' }}>{scanNudge.message}</span>}
      {['high', 'medium', 'low'].map((s) => sev[s] > 0 && (
        <button key={s} onClick={() => onFilter(sevFilter === s ? null : s)} className="px-2 py-0.5 rounded text-xs uppercase tracking-wide shrink-0"
          style={chip(s)}>{sev[s]} {s}</button>
      ))}
      <span className="flex-1 min-w-[8px]" />
      <span className="inline-flex items-center gap-2 shrink-0">
        <button data-tutorial="group" onClick={onGroup} className="px-2 py-1 rounded text-xs" style={{ ...ghost, opacity: groupMode ? 1 : 0.55 }}>Group {groupMode ? 'on' : 'off'}</button>
        <button data-tutorial="map" onClick={onHeatmap} className="px-2 py-1 rounded text-xs" style={{ ...ghost, opacity: heatmapOn ? 1 : 0.55 }}>Map {heatmapOn ? 'on' : 'off'}</button>
      </span>
      {onFigma && (
        <button onClick={onFigma} className="px-2 py-1 rounded text-xs shrink-0" style={ghost}>View raw Figma file</button>
      )}
      {onTutorial && (
        <button onClick={onTutorial} className="px-2 py-1 rounded text-xs shrink-0" style={ghost}>Tutorial</button>
      )}
      <button onClick={onRescan} disabled={busy} className="px-2 py-1 rounded text-xs disabled:opacity-40 shrink-0" style={ghost}>Rescan</button>
      {onHardRescan && !demoMode && (
        <button onClick={onHardRescan} disabled={busy} className="px-2 py-1 rounded text-xs disabled:opacity-40 shrink-0" style={{ ...ghost, color: '#f5a623', borderColor: '#f5a62355' }} title="Clear dismissals and rerun AI from scratch">Hard rescan</button>
      )}
    </div>
  );
}

function FigmaViewOnly({ frame }) {
  const imgSrc = frame?.image || frame?.imageUrl || '';
  if (frame?.embedUrl) {
    return <iframe src={frame.embedUrl} title="Figma" className="w-full h-full border-0" allowFullScreen />;
  }
  if (imgSrc) {
    return <img src={imgSrc} alt="Figma frame" className="w-full h-full object-contain object-center" draggable={false} />;
  }
  return <p className="p-8 text-sm text-center" style={{ color: paper(0.5) }}>No Figma preview available.</p>;
}

function FigmaModal({ frame, open, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 modal-backdrop" style={{ background: 'rgba(17,17,19,0.78)' }}
      onClick={onClose} role="dialog" aria-modal="true" aria-label="Raw Figma file">
      <div className="enter rounded-xl overflow-hidden flex flex-col w-full max-w-5xl shadow-2xl" style={{ border: `1px solid ${paper(0.2)}`, background: '#111', maxHeight: '88vh' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${paper(0.1)}` }}>
          <span className="text-sm" style={{ color: paper(0.65) }}>Raw Figma file · view only</span>
          <button onClick={onClose} className="px-3 py-1 rounded text-xs" style={{ border: `1px solid ${paper(0.3)}`, color: paper(0.9) }}>Close</button>
        </div>
        <div className="flex-1 min-h-0" style={{ height: 'min(75vh, 720px)' }}>
          <FigmaViewOnly frame={frame} />
        </div>
      </div>
    </div>
  );
}

function syncBg(sev) { return sev ? `${SEVCOLOR[sev]}40` : paper(0.12); }
function syncOutline(sev, source = false) {
  const c = sev ? SEVCOLOR[sev] : paper(0.9);
  return `${source ? 3 : 2}px solid ${source ? paper(0.95) : c}`;
}
function panelSyncStyle(panel, sync, drift) {
  if (!drift?.severity || !sync?.source || panel === 'problems') return {};
  const color = SEVCOLOR[drift.severity];
  const sourcePanel = { token: 'tokens', line: 'code', selector: 'preview', nav: 'problems' }[sync.source];
  if (!['tokens', 'code', 'preview'].includes(panel)) return {};
  return { boxShadow: panel === sourcePanel ? `inset 0 0 0 3px ${color}` : `inset 0 0 0 2px ${color}55`, transition: 'none' };
}

function SetupGate() {
  return (
    <div className="flex flex-col items-center justify-center h-screen px-6 text-center">
      <img src="/logo.png" alt="penny" className="h-10 w-auto mb-8" style={{ mixBlendMode: 'screen' }} />
      <h1 className="text-xl font-semibold mb-3" style={{ color: paper(0.95) }}>Run Penny in your terminal to set up</h1>
      <p className="text-sm mb-6 max-w-md leading-relaxed" style={{ color: paper(0.55) }}>
        Complete onboarding once (`penny onboarding`), then open the dashboard. Figma is optional — the bundled demo works without it.
      </p>
      <div className="mono text-sm px-4 py-3 rounded-lg mb-2 w-full max-w-sm text-left" style={{ background: paper(0.06), border: `1px solid ${paper(0.14)}`, color: paper(0.85) }}>
        penny onboarding
      </div>
      <div className="mono text-sm px-4 py-3 rounded-lg w-full max-w-sm text-left" style={{ background: paper(0.04), border: `1px solid ${paper(0.1)}`, color: paper(0.65) }}>
        penny view
      </div>
    </div>
  );
}

function ScanOverlay({ mode, aiLive }) {
  const hard = mode === 'hard';
  return (
    <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center px-6" style={{ background: 'rgba(17,17,17,0.94)' }}>
      <div className="relative mb-10 flex items-center justify-center" style={{ width: 88, height: 88 }}>
        <span className="absolute inset-0 rounded-full scan-ring" style={{ border: `2px solid ${paper(0.25)}` }} />
        <span className="absolute inset-2 rounded-full scan-ring" style={{ border: `1px solid ${paper(0.15)}`, animationDelay: '0.6s' }} />
        <img src="/logo.png" alt="" className="h-11 w-auto scan-pulse relative z-10" style={{ mixBlendMode: 'screen' }} />
      </div>
      <h2 className="text-xl font-semibold mb-2 text-center" style={{ color: paper(0.95) }}>
        {hard ? 'Hard rescan in progress' : 'Rescanning'}
      </h2>
      <p className="text-sm mb-8 text-center max-w-sm leading-relaxed" style={{ color: paper(0.5) }}>
        {hard
          ? 'Clearing dismissals and running fresh AI analysis on every page.'
          : 'Re-reading sources and updating drift results.'}
        {aiLive ? ' Live AI scans can take a few minutes.' : ''}
      </p>
      <div className="w-72 h-1.5 rounded-full overflow-hidden" style={{ background: paper(0.08) }}>
        <div className="h-full w-1/3 rounded-full scan-bar" style={{ background: hard ? '#f5a623' : paper(0.75) }} />
      </div>
    </div>
  );
}

function TokenPanel({ tokens, activeName, problemNames, onPick, syncSource, syncId, severity }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeName]);
  const groups = useMemo(() => {
    const order = ['color', 'typography', 'spacing'];
    const labels = { color: 'colors', typography: 'typography', spacing: 'spacing & radius' };
    return order.map((type) => ({ type, label: labels[type], items: tokens.filter((t) => t.type === type) })).filter((g) => g.items.length);
  }, [tokens]);
  const renderRow = (t) => {
    const on = t.name === activeName;
    const problem = problemNames.has(t.name);
    const isSource = syncSource === 'token' && syncId === t.name;
    const isLinked = on && problem;
    return (
      <div key={t.name} data-active={on} role={problem ? 'button' : undefined} tabIndex={problem ? 0 : undefined}
        onClick={problem ? () => onPick(t.name) : undefined}
        className={`pl-4 py-0.5 rounded flex flex-wrap items-center gap-x-2 gap-y-0.5 sync-now ${problem ? 'cursor-pointer' : 'cursor-default'}`}
        style={{
          background: isLinked ? syncBg(severity) : 'transparent',
          outline: isSource ? syncOutline(severity, true) : isLinked ? syncOutline(severity) : 'none',
          outlineOffset: -1,
          opacity: problem ? 1 : 0.38,
        }}>
        <TokenGlyph t={t} />
        <span style={{ color: on && problem ? paper(1) : paper(problem ? 0.85 : 0.45) }}>"{t.name}"</span>
        <span style={{ color: paper(0.4) }}>:</span>
        <span style={{ color: problem ? CODE.string : paper(0.35) }}>"{t.label || t.value}"</span>
        {t.nodePath && <span className="text-[10px] w-full pl-6" style={{ color: paper(problem ? 0.35 : 0.25) }}>{t.nodePath}</span>}
        <span className="ml-auto text-[10px] uppercase tracking-wide" style={{ color: paper(problem ? 0.35 : 0.22) }}>{t.type}</span>
      </div>
    );
  };
  return (
    <div ref={ref} className="code-scroll mono text-[12px] leading-[1.55] p-3 overflow-auto h-full">
      <span style={{ color: paper(0.4) }}>{'{'}</span>
      {groups.map((g) => (
        <div key={g.type} className="py-1">
          <div className="pl-2 py-0.5 text-[10px] uppercase tracking-wider" style={{ color: paper(0.28) }}>// {g.label}</div>
          {g.items.map(renderRow)}
        </div>
      ))}
      <span style={{ color: paper(0.4) }}>{'}'}</span>
    </div>
  );
}

function iframeDoc(iframe) {
  try { return iframe?.contentDocument ?? null; } catch { return null; }
}

function iframeWin(iframe) {
  try { return iframe?.contentWindow ?? null; } catch { return null; }
}

function DriftMapOverlay({ iframeRef, markers, visible, contentKey }) {
  useEffect(() => {
    const clear = () => {
      const doc = iframeDoc(iframeRef.current);
      if (doc) clearMapInIframe(doc);
    };
    if (!visible || !markers.length) {
      clear();
      return undefined;
    }
    const render = () => {
      const doc = iframeDoc(iframeRef.current);
      if (doc?.body) renderMapInIframe(doc, markers);
    };
    render();
    const timers = [80, 250, 600, 1200].map((ms) => setTimeout(render, ms));
    const poll = setInterval(render, 1500);
    const iframe = iframeRef.current;
    iframe?.addEventListener('load', render);
    const win = iframeWin(iframe);
    try { win?.addEventListener('scroll', render, true); } catch { /* cross-origin */ }
    window.addEventListener('resize', render);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(poll);
      iframe?.removeEventListener('load', render);
      try { win?.removeEventListener('scroll', render, true); } catch { /* cross-origin */ }
      window.removeEventListener('resize', render);
      clear();
    };
  }, [visible, markers, contentKey, iframeRef]);
  return null;
}

function RenderedWindow({ iframeRef, page, highlightDrift, mapOn, pulseSelectors, refreshKey }) {
  const spotSelectors = useMemo(
    () => (mapOn ? [] : spotlightSelectorsFromDrift(highlightDrift)),
    [highlightDrift, mapOn],
  );
  const previewKind = useMemo(
    () => page.previewKind || detectPreviewKind(page.src, page.srcFile, page.html || ''),
    [page.previewKind, page.src, page.srcFile, page.html],
  );
  const pulseCss = useMemo(() => {
    if (!pulseSelectors?.size) return '';
    const tw = previewKind === PREVIEW_KIND.TAILWIND_JSX || previewKind === PREVIEW_KIND.REACT_JSX
      || previewKind === PREVIEW_KIND.VUE || previewKind === PREVIEW_KIND.SVELTE;
    return buildPulseCss([...pulseSelectors], tw);
  }, [pulseSelectors, previewKind]);
  const srcDoc = useMemo(
    () => buildPreviewDocument({
      src: page.src,
      srcFile: page.srcFile,
      html: page.html || '',
      previewKind,
      spotSelectors,
      extraCss: pulseCss,
    }),
    [page.src, page.srcFile, page.html, previewKind, spotSelectors, pulseCss],
  );
  const sandbox = previewSandbox(previewKind);

  useEffect(() => {
    if (mapOn || !highlightDrift) return undefined;
    const scroll = () => {
      const doc = iframeDoc(iframeRef.current);
      if (doc) scrollDriftIntoView(doc, highlightDrift);
    };
    scroll();
    const timers = [50, 200, 500].map((ms) => setTimeout(scroll, ms));
    const iframe = iframeRef.current;
    iframe?.addEventListener('load', scroll);
    return () => {
      timers.forEach(clearTimeout);
      iframe?.removeEventListener('load', scroll);
    };
  }, [highlightDrift?.id, mapOn, srcDoc, refreshKey, iframeRef]);

  return (
    <iframe
      key={refreshKey}
      ref={iframeRef}
      title="Rendered page"
      srcDoc={srcDoc}
      sandbox={sandbox}
      className="w-full h-full border-0 bg-white"
    />
  );
}

function Cinema({ drift }) {
  if (!drift) return null;
  const expected = drift.expected ?? drift.token?.value;
  const displayExpected = drift.type === 'typography' && drift.token?.label ? drift.token.label : expected;
  const found = drift.actualValues ?? [];
  if (drift.type === 'color' && displayExpected && found.length) {
    const multi = found.length > 1;
    const swatch = (value, label, highlight) => (
      <div key={value + label} className="text-center shrink-0">
        <div className="rounded-lg mx-auto mb-2" style={{
          width: multi ? 64 : 72, height: multi ? 64 : 72, background: value,
          border: `2px solid ${highlight ? SEVCOLOR[drift.severity] : paper(0.3)}`,
        }} />
        <div className="text-xs uppercase tracking-wide" style={{ color: paper(0.5) }}>{label}</div>
        <code className="mono text-xs" style={{ color: highlight ? SEVCOLOR[drift.severity] : paper(0.7) }}>{value}</code>
      </div>
    );
    return (
      <div className="flex flex-wrap items-center justify-center gap-4 py-3 px-4">
        {swatch(displayExpected, 'Design', false)}
        <div className="text-2xl shrink-0" style={{ color: paper(0.3) }}>{multi ? 'vs' : '→'}</div>
        {multi ? (
          <div className="flex flex-wrap items-center justify-center gap-5">
            {found.map((v) => swatch(v, 'Shipped', true))}
          </div>
        ) : swatch(found[0], 'Shipped', true)}
      </div>
    );
  }
  if ((drift.type === 'spacing' || drift.type === 'typography') && displayExpected != null) {
    const expPx = parseFloat(displayExpected) || 0;
    const values = found.length ? found : [displayExpected];
    const multi = values.length > 1;
    const max = Math.max(expPx, ...values.map((v) => parseFloat(v) || 0), 1) * 1.2;
    const bar = (value, label, highlight) => (
      <div key={value + label} className="text-center shrink-0">
        <div className="mx-auto rounded-sm" style={{ width: 48, height: `${((parseFloat(value) || 0) / max) * 80}px`, minHeight: 8, background: highlight ? SEVCOLOR[drift.severity] : paper(0.9) }} />
        <div className="text-xs mt-2" style={{ color: highlight ? SEVCOLOR[drift.severity] : paper(0.5) }}>{label} {value}</div>
      </div>
    );
    return (
      <div className="flex flex-wrap items-end justify-center gap-8 py-4 px-4">
        {bar(String(displayExpected), 'Design', false)}
        <div className="text-lg shrink-0 pb-6" style={{ color: paper(0.3) }}>{multi ? 'vs' : '→'}</div>
        {multi ? (
          <div className="flex flex-wrap items-end justify-center gap-6">
            {values.map((v) => bar(v, 'Shipped', true))}
          </div>
        ) : bar(values[0], 'Shipped', true)}
      </div>
    );
  }
  return null;
}

function CodeView({ src, scrollLine, curLines, lineSev, edits = {}, appliedLines = {}, onLine, height, syncSource, syncId, severity, inlineEdit, onInlineEdit, editLine }) {
  const ref = useRef(null);
  const lines = useMemo(() => src.split('\n'), [src]);
  useEffect(() => {
    if (!scrollLine || !ref.current) return;
    const run = () => {
      const el = ref.current?.querySelector(`[data-line="${scrollLine}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    run();
    const t = requestAnimationFrame(run);
    return () => cancelAnimationFrame(t);
  }, [scrollLine, src]);
  const rows = [];
  lines.forEach((ln, i) => {
    const no = i + 1;
    const edit = edits[no];
    const applied = appliedLines[no];
    const hl = curLines.has(no);
    const isSource = syncSource === 'line' && syncId === no;
    const isLinked = hl;
    if (applied && applied.before !== applied.after && ln !== applied.before) {
      rows.push(
        <div key={`r${no}`} className="sync-now flex" style={{ background: DIFF.rmBg, borderLeft: `3px solid ${DIFF.rmFg}` }}>
          <span className="select-none w-9 shrink-0 pr-2 text-right" style={{ color: paper(0.3) }}>{no}</span>
          <span className="w-4 shrink-0 text-center" style={{ color: DIFF.rmFg }}>−</span>
          <span className="pr-3"><Code text={applied.before || ' '} /></span>
        </div>,
      );
    }
    const bg = applied ? DIFF.appliedBg : edit ? DIFF.rmBg : isLinked ? syncBg(severity) : 'transparent';
    const borderLeft = applied ? `3px solid ${DIFF.appliedBorder}` : isSource ? syncOutline(severity, true) : isLinked ? syncOutline(severity) : '3px solid transparent';
    const marker = applied ? { ch: '✓', color: DIFF.appliedBorder } : edit ? { ch: '-', color: DIFF.rmFg } : { ch: lineSev[no] ? '●' : '', color: lineSev[no] ? SEVCOLOR[lineSev[no]] : 'transparent' };
    rows.push(
      <div key={`l${no}`} data-line={no} onClick={() => onLine(no)} className="sync-now flex cursor-pointer" style={{ background: bg, borderLeft, outline: isSource ? syncOutline(severity, true) : 'none', outlineOffset: -1 }}>
        <span className="select-none w-9 shrink-0 pr-2 text-right" style={{ color: paper(0.3) }}>{no}</span>
        <span className="w-4 shrink-0 text-center" style={{ color: marker.color }}>{marker.ch}</span>
        <span className="pr-3"><Code text={ln || ' '} /></span>
      </div>,
    );
    if (edit && !applied) rows.push(
      <div key={`a${no}`} className="sync-now flex" style={{ background: DIFF.addBg, borderLeft: `3px solid ${DIFF.addFg}` }}>
        <span className="select-none w-9 shrink-0 pr-2 text-right" style={{ color: paper(0.15) }} />
        <span className="w-4 shrink-0 text-center" style={{ color: DIFF.addFg }}>+</span>
        <span className="pr-3 flex-1">
          {inlineEdit && editLine === no ? (
            <input className="w-full mono text-[12px] bg-transparent border-b outline-none" style={{ color: DIFF.addFg, borderColor: paper(0.3) }}
              value={edit.after} onChange={(e) => onInlineEdit(no, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} autoFocus />
          ) : (
            <span onDoubleClick={() => onInlineEdit?.(no, edit.after, true)} title="Double-click to edit"><Code text={edit.after} /></span>
          )}
        </span>
      </div>,
    );
  });
  return <div ref={ref} className="code-scroll mono text-[12px] leading-[1.6] min-h-0" style={{ height: height ?? '100%', overflow: 'auto' }}>{rows}</div>;
}

function ProblemPanel({ n, total, drift, onPrev, onNext, groupLabel }) {
  const arrow = 'w-8 h-8 rounded flex items-center justify-center text-lg select-none sync-now';
  const linked = !!drift;
  const typeLabel = drift?.category === 'off-palette' ? 'Off palette'
    : drift?.category === 'off-scale' ? 'Off scale'
      : drift?.type === 'color' ? 'Color'
        : drift?.type === 'spacing' ? 'Spacing'
          : drift?.type === 'typography' ? 'Typography' : drift?.type;
  return (
    <div className="p-4 sync-now" style={{
      background: linked ? syncBg(drift.severity) : 'transparent',
    }}>
      <div className="flex items-center justify-between mb-3">
        <button onClick={onPrev} className={arrow} style={{ border: `1px solid ${paper(0.25)}` }}>‹</button>
        <div className="text-center text-sm">
          <div style={{ color: paper(0.6) }}>Problem {total ? n + 1 : 0} / {total}{groupLabel ? ` · ${groupLabel}` : ''}</div>
          {drift && <div className="uppercase text-[11px] tracking-wide" style={{ color: SEVCOLOR[drift.severity] }}>{typeLabel}</div>}
        </div>
        <button onClick={onNext} className={arrow} style={{ border: `1px solid ${paper(0.25)}` }}>›</button>
      </div>
      {!drift ? (
        <p className="text-center py-6" style={{ color: paper(0.6) }}>No inconsistencies found in this file.</p>
      ) : (
        <div className="space-y-2.5 text-sm">
          {drift.expected != null && drift.category !== 'off-palette' && drift.category !== 'off-scale' && (
            <div><span className="inline-block w-[74px]" style={{ color: paper(0.55) }}>expected</span><Chip type={drift.type} value={drift.type === 'typography' && drift.token?.label ? drift.token.label : drift.expected} /></div>
          )}
          <div><span className="inline-block w-[74px] align-top" style={{ color: paper(0.55) }}>found</span>{drift.actualValues.map((v) => <Chip key={v} type={drift.type} value={v} />)}</div>
          {(drift.elementName || drift.locations?.[0]?.elementName) && (
            <p><span style={{ color: paper(0.55) }}>element&nbsp;</span>{drift.elementName || drift.locations[0].elementName}</p>
          )}
          {(drift.problem || drift.why) && <p className="pt-1"><span style={{ color: paper(0.55) }}>problem&nbsp;&nbsp;</span>{drift.problem || drift.why}</p>}
          {(drift.solution || drift.fix) && <p><span style={{ color: paper(0.55) }}>solution</span>&nbsp;&nbsp;{drift.solution || drift.fix}</p>}
        </div>
      )}
    </div>
  );
}

function SuccessState({ onRescan, busy, scanNudge, driftScore }) {
  return (
    <div className="enter flex flex-col items-center justify-center py-20 px-6 text-center rounded-xl" style={{ border: `1px solid ${paper(0.14)}`, background: paper(0.04) }}>
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4 text-2xl success-check" style={{ background: 'rgba(96,196,128,0.2)', color: '#82d69a' }}>✓</div>
      <h2 className="text-xl font-semibold mb-2" style={{ color: paper(0.95) }}>Design and code are aligned</h2>
      <p className="text-sm mb-2 max-w-md" style={{ color: paper(0.55) }}>No token drift detected across your sources.</p>
      {driftScore != null && <p className="text-sm mb-4" style={{ color: '#82d69a' }}>{driftScore}% token adherence</p>}
      {scanNudge?.delta > 0 && <p className="text-xs mb-4" style={{ color: '#82d69a' }}>{scanNudge.message}</p>}
      <button onClick={onRescan} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-40" style={{ background: paper(1), color: '#111' }}>Rescan</button>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function agentPrompt(page, drift) {
  const where = drift.locations.map((l) => `  - ${l.file}:${l.line}  ${l.selector}  (${l.raw})`).join('\n');
  return `Fix this design-token drift in ${page.srcFile}.\n\nType: ${drift.type} (${drift.category})\nExpected: ${drift.expected ?? 'n/a'}\nFound: ${drift.actualValues.join(', ')}\nElement: ${drift.elementName || drift.locations[0]?.elementName || 'n/a'}\nLocations:\n${where}\n\nProblem: ${drift.problem || drift.why || ''}\nSolution: ${drift.solution || drift.fix || ''}`;
}

function FixPanel({ active, drift, plan, curPlan, busy, applying, agentName, onApplyThis, onApplyAll, onApplyGroup, onAsk, onDismiss, onRestore, onRevert, dismissed, groupCount, groupApplicable }) {
  const primaryBtn = { background: paper(1), color: '#111111' };
  const ghostBtn = { border: `1px solid ${paper(0.3)}`, color: paper(0.9) };
  const fixable = hasApplicableEdits(curPlan);
  return (
    <Win title="Fix mode" className="sync-now" style={applying ? { boxShadow: `inset 0 0 0 3px ${DIFF.appliedBorder}`, transition: 'none' } : {}}>
      <div className="p-3 space-y-2">
        <button disabled={busy || !fixable} onClick={onApplyThis} className="w-full py-2 rounded font-semibold text-sm disabled:opacity-40 sync-now" style={{ ...primaryBtn, opacity: applying ? 0.7 : (fixable ? 1 : 0.45) }}>{applying ? 'Applying…' : 'Apply this solution'}</button>
        {groupCount > 1 && <button disabled={busy || groupApplicable === 0} onClick={onApplyGroup} className="w-full py-2 rounded font-semibold text-sm disabled:opacity-40" style={{ ...primaryBtn, opacity: groupApplicable ? 1 : 0.45 }}>Fix group ({groupApplicable || groupCount})</button>}
        <button disabled={busy || plan.length === 0} onClick={onApplyAll} className="w-full py-2 rounded font-semibold text-sm disabled:opacity-40" style={primaryBtn}>Apply all ({plan.length})</button>
        <button disabled={busy || !drift} onClick={onAsk} className="w-full py-2 rounded font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2" style={ghostBtn} title="Copy fix prompt to clipboard">
          Ask {agentName || 'your agent'}
          <CopyIcon />
        </button>
        <button disabled={busy || !drift} onClick={onDismiss} className="w-full py-2 rounded text-sm disabled:opacity-40" style={ghostBtn}>Dismiss this suggestion</button>
        {!fixable && drift && <p className="text-[11px] pt-0.5" style={{ color: paper(0.5) }}>No line-level fix — advisory only; copy the prompt to your agent.</p>}
        {dismissed > 0 && <button disabled={busy} onClick={onRestore} className="w-full py-1.5 rounded text-xs disabled:opacity-40" style={ghostBtn}>Restore {dismissed} dismissed</button>}
        {active?.dirty && <button disabled={busy} onClick={onRevert} className="w-full py-1.5 rounded text-xs disabled:opacity-40" style={ghostBtn}>Revert {active.name}</button>}
      </div>
    </Win>
  );
}

function HistoryPanel({ history, onJump }) {
  if (!history?.length) return null;
  return (
    <Win title="Session history" className="shrink-0" style={{ maxHeight: 120, overflow: 'hidden' }}>
      <div className="overflow-y-auto p-2 space-y-1 max-h-[100px]">
        {history.slice(0, 8).map((h) => (
          <button key={h.id} onClick={() => onJump(h)} className="w-full text-left text-[10px] px-2 py-1 rounded" style={{ background: paper(0.04), color: paper(0.65) }}>
            {h.action} · {h.pageName || h.pageId}{h.ids ? ` (${h.ids.length})` : ''}
          </button>
        ))}
      </div>
    </Win>
  );
}

function ShortcutsModal({ onClose }) {
  const rows = [
    ['↑↓ / ←→', 'Cycle problems / pages'], ['f', 'Apply fix'], ['a', 'Apply all'], ['d', 'Dismiss'],
    ['g', 'Toggle group mode'], ['m', 'Toggle heatmap'],
    ['/', 'Search drifts'], ['h', 'This help'], ['esc', 'Close modals'],
  ];
  return (
    <div className="fixed inset-0 z-[9995] flex items-center justify-center p-6" style={{ background: 'rgba(17,17,17,0.8)' }} onClick={onClose}>
      <div className="rounded-xl p-5 max-w-sm w-full" style={{ background: '#1a1a1a', border: `1px solid ${paper(0.2)}` }} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: paper(0.9) }}>Keyboard shortcuts</h3>
        <div className="space-y-1.5">{rows.map(([k, v]) => (
          <div key={k} className="flex justify-between text-xs"><code style={{ color: paper(0.85) }}>{k}</code><span style={{ color: paper(0.5) }}>{v}</span></div>
        ))}</div>
        <button onClick={onClose} className="mt-4 w-full py-1.5 rounded text-xs" style={{ border: `1px solid ${paper(0.3)}`, color: paper(0.9) }}>Close</button>
      </div>
    </div>
  );
}

function TutorialOverlay({ step, onNext, onBack, onSkip }) {
  const current = TUTORIAL_STEPS[step];
  const [rect, setRect] = useState(null);
  const total = TUTORIAL_STEPS.length;
  const isLast = step === total - 1;
  const isFirst = step === 0;

  useEffect(() => {
    const target = current.target;
    if (!target) { setRect(null); return undefined; }
    const measure = () => {
      const el = document.querySelector(target);
      if (!el) { setRect(null); return; }
      const pad = 6;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    const el = document.querySelector(target);
    if (el && ro) ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [step, current.target]);

  useEffect(() => {
    if (!current.target) return undefined;
    const el = document.querySelector(current.target);
    if (!el) return undefined;
    el.classList.add('tutorial-spotlight-target');
    return () => el.classList.remove('tutorial-spotlight-target');
  }, [step, current.target]);

  const cardStyle = useMemo(() => {
    if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', maxWidth: 380 };
    const gap = 16;
    const cardW = 340;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.top + rect.height + gap;
    let left = rect.left + rect.width / 2 - cardW / 2;
    if (current.placement === 'right') { left = rect.left + rect.width + gap; top = rect.top + rect.height / 2 - 80; }
    else if (current.placement === 'left') { left = rect.left - cardW - gap; top = rect.top + rect.height / 2 - 80; }
    else if (current.placement === 'top') { top = rect.top - 180 - gap; left = rect.left + rect.width / 2 - cardW / 2; }
    else if (top + 180 > vh) top = Math.max(gap, rect.top - 180 - gap);
    left = Math.max(gap, Math.min(left, vw - cardW - gap));
    top = Math.max(gap, Math.min(top, vh - 200));
    return { top, left, maxWidth: cardW, transform: 'none' };
  }, [rect, current.placement]);

  const primaryBtn = { background: paper(1), color: '#111111' };
  const ghostBtn = { border: `1px solid ${paper(0.3)}`, color: paper(0.9) };

  return (
    <div className="fixed inset-0 z-[9990]" aria-modal="true" role="dialog" aria-label="Tutorial" onMouseDown={(e) => e.preventDefault()}>
      <div className="absolute inset-0" style={{ background: rect ? 'transparent' : 'rgba(17,17,17,0.82)' }} />
      {rect && (
        <div className="pointer-events-none" style={{
          position: 'fixed', top: rect.top, left: rect.left, width: rect.width, height: rect.height,
          borderRadius: 12, border: `2px solid ${paper(0.85)}`, boxShadow: '0 0 0 9999px rgba(17,17,17,0.82)',
          zIndex: 9991,
        }} />
      )}
      {!rect && <div className="absolute inset-0" style={{ background: 'rgba(17,17,17,0.82)', zIndex: 9990 }} />}
      <div className="enter fixed z-[9999] rounded-xl p-5 shadow-2xl" style={{
        ...cardStyle, border: `1px solid ${paper(0.2)}`, background: '#1a1a1a', width: cardStyle.maxWidth,
      }}>
        <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: paper(0.45) }}>Step {step + 1} of {total}</div>
        <h2 className="text-lg font-semibold mb-2" style={{ color: paper(0.95) }}>{current.title}</h2>
        <p className="text-sm mb-4 leading-relaxed" style={{ color: paper(0.65) }}>{current.body}</p>
        <div className="flex items-center gap-2">
          {!isFirst && <button onClick={onBack} className="px-3 py-1.5 rounded text-xs" style={ghostBtn}>Back</button>}
          <span className="flex-1" />
          <button onClick={onSkip} className="px-3 py-1.5 rounded text-xs" style={ghostBtn}>Skip</button>
          <button onClick={onNext} className="px-3 py-1.5 rounded text-xs font-semibold" style={primaryBtn}>{isLast ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [d, setD] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [cur, setCur] = useState(0);
  const [busy, setBusy] = useState(false);
  const [scanMode, setScanMode] = useState(null);
  const [toast, setToast] = useState({ msg: '', show: false });
  const [sevFilter, setSevFilter] = useState(null);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialActive, setTutorialActive] = useState(false);
  const [sync, setSync] = useState({ source: null, id: null });
  const [appliedLines, setAppliedLines] = useState({});
  const [applying, setApplying] = useState(false);
  const [figmaOpen, setFigmaOpen] = useState(false);
  const [heatmapOn, setHeatmapOn] = useState(false);
  const [groupMode, setGroupMode] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [inlineEdits, setInlineEdits] = useState({});
  const [editLine, setEditLine] = useState(null);
  const [pulseSelectors, setPulseSelectors] = useState(new Set());
  const [localFocus, setLocalFocus] = useState(true);
  const toastT = useRef(null);
  const driftInit = useRef(false);
  const previewIframeRef = useRef(null);
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const bumpPreview = () => setPreviewRefresh((n) => n + 1);
  const prevDriftCount = useRef(null);

  useEffect(() => {
    api.state().then((snap) => {
      setD(snap);
      if (!snap.onboardingComplete) return;
      const done = snap.tutorialComplete || localStorage.getItem(TUTORIAL_STORAGE) === '1';
      if (urlTutorial() || !done) {
        setTutorialStep(0);
        setTutorialActive(true);
      }
    }).catch((e) => setD({ onboardingComplete: true, pages: [], loadError: e.message }));
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      const snap = JSON.parse(e.data);
      if (!Array.isArray(snap.pages)) return;
      setD(snap);
      if (!localFocus && snap.focus?.pageId) {
        setActiveId(snap.focus.pageId);
        if (typeof snap.focus.driftIdx === 'number') setCur(snap.focus.driftIdx);
      }
    };
    return () => es.close();
  }, [localFocus]);

  const flash = (m) => { setToast({ msg: m, show: true }); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2400); };

  const pages = d?.pages ?? [];
  const active = pages.find((p) => p.id === activeId) || pages[0] || null;
  useEffect(() => { setCur(0); setSevFilter(null); setAppliedLines({}); setApplying(false); setInlineEdits({}); }, [active?.id]);

  let rawDrifts = active?.drifts ?? [];
  if (sevFilter) rawDrifts = rawDrifts.filter((dr) => dr.severity === sevFilter);
  if (searchQ.trim()) {
    const q = searchQ.toLowerCase();
    rawDrifts = rawDrifts.filter((dr) =>
      dr.token?.name?.toLowerCase().includes(q) || dr.category?.includes(q)
      || dr.locations?.some((l) => l.selector?.toLowerCase().includes(q)));
  }
  const groups = useMemo(() => groupDrifts(rawDrifts, groupMode ? 'token' : 'none'), [rawDrifts, groupMode]);
  const drifts = groupMode ? (groups[cur]?.drifts ?? []) : rawDrifts;
  const currentGroup = groupMode ? groups[cur] : null;
  const plan = active?.plan ?? [];
  const N = groupMode ? groups.length : drifts.length;
  const idx = N ? Math.min(cur, N - 1) : 0;
  const drift = groupMode ? (groups[idx]?.drifts?.[0] ?? null) : (drifts[idx] || null);
  const groupDriftIds = groupMode ? (groups[idx]?.ids ?? []) : (drift ? [drift.id] : []);
  const curPlan = plan.find((p) => p.id === drift?.id) || null;
  const canApplyThis = hasApplicableEdits(curPlan);
  const applicableGroupIds = useMemo(
    () => groupDriftIds.filter((id) => hasApplicableEdits(plan.find((p) => p.id === id))),
    [groupDriftIds, plan],
  );

  const allDrifts = useMemo(() => pages.flatMap((p) => p.drifts || []), [pages]);
  const totalDrifts = allDrifts.length;

  useEffect(() => {
    if (driftInit.current || !d || !active) return;
    const pi = urlPage();
    if (pi) setActiveId(pi);
    const di = urlDrift();
    if (di != null && !Number.isNaN(di) && di >= 0) { setCur(Math.min(di, (active.drifts?.length || 1) - 1)); driftInit.current = true; }
    else if (pi) driftInit.current = true;
  }, [d, active]);

  useEffect(() => {
    if (!d?.scanNudge?.message) return;
    flash(d.scanNudge.message);
  }, [d?.scanNudge?.message, d?.scanNudge?.driftCount]);

  useEffect(() => {
    prevDriftCount.current = totalDrifts;
  }, [totalDrifts]);

  const mapDrifts = useMemo(
    () => (heatmapOn ? (active?.drifts ?? []) : []),
    [heatmapOn, active?.drifts],
  );
  const mapMarkers = useMemo(() => collectMapMarkers(mapDrifts), [mapDrifts]);
  const previewContentKey = `${active?.id ?? ''}-${active?.src?.length ?? 0}-${heatmapOn}-${previewRefresh}`;

  const spotSelectors = useMemo(() => spotlightSelectorsFromDrift(drift), [drift]);

  useEffect(() => {
    if (!drift || !localFocus) return;
    const t = setTimeout(() => api.focus(active?.id, idx), 300);
    return () => clearTimeout(t);
  }, [active?.id, idx, drift?.id, localFocus]);

  const curLines = useMemo(
    () => new Set(drift ? highlightLocations(drift).map((l) => l.line) : []),
    [drift],
  );
  const scrollLine = useMemo(() => {
    if (!drift) return null;
    const locs = highlightLocations(drift);
    return locs.length ? Math.min(...locs.map((l) => l.line)) : null;
  }, [drift]);
  const curSelectors = useMemo(() => new Set(spotSelectors), [spotSelectors]);
  const lineSev = useMemo(() => {
    const m = {};
    for (const dr of (active?.drifts ?? [])) for (const l of dr.locations) if (!m[l.line] || RANK[dr.severity] > RANK[m[l.line]]) m[l.line] = dr.severity;
    return m;
  }, [active?.drifts]);
  const editByLine = useMemo(() => {
    const m = {};
    if (curPlan) for (const e of curPlan.edits) m[e.line] = { after: inlineEdits[e.line] ?? e.after };
    return m;
  }, [curPlan, inlineEdits]);

  const problemTokens = useMemo(
    () => new Set((active?.drifts ?? []).map((dr) => dr.token?.name).filter(Boolean)),
    [active?.drifts],
  );

  const selectDriftIndex = (i, source, id) => {
    if (i < 0) return;
    setLocalFocus(true);
    setAppliedLines({});
    setApplying(false);
    setSync({ source, id });
    setCur(i);
  };
  const go = (delta) => {
    if (!N) return;
    const next = (idx + delta + N) % N;
    setSync({ source: 'nav', id: next });
    setCur(next);
  };
  const jumpToLine = (line) => selectDriftIndex(drifts.findIndex((dr) => dr.locations.some((l) => l.line === line)), 'line', line);
  const jumpToToken = (name) => selectDriftIndex(drifts.findIndex((dr) => dr.token?.name === name), 'token', name);
  const jumpToSelector = (sel) => {
    selectDriftIndex(drifts.findIndex((dr) => dr.locations.some((l) => l.selector === sel || l.selector.includes(sel) || sel.includes(l.selector))), 'selector', sel);
  };

  const collectAppliedEdits = (ids) => {
    const srcLines = active.src.split('\n');
    const items = ids ? plan.filter((p) => ids.includes(p.id)) : plan;
    const out = {};
    for (const item of items) for (const e of item.edits) out[e.line] = { before: e.before ?? srcLines[e.line - 1] ?? '', after: e.after };
    return out;
  };

  useEffect(() => {
    if (!Object.keys(appliedLines).length) return undefined;
    const t = setTimeout(() => setAppliedLines({}), 12000);
    return () => clearTimeout(t);
  }, [appliedLines]);

  const applySnap = async (fn, okMsg, mode = 'rescan') => {
    setScanMode(mode);
    setBusy(true);
    try {
      setD(await fn());
      if (okMsg) flash(okMsg);
      return true;
    } catch (e) {
      if (e.snapshot) setD(e.snapshot);
      flash(e.message || 'Request failed');
      if (!e.snapshot) {
        try { setD(await api.state()); } catch { /* keep prior state */ }
      }
      return false;
    } finally {
      setBusy(false);
      setScanMode(null);
    }
  };

  const rescan = async () => { await applySnap(() => api.scan(), 'Rescanned.', 'rescan'); };
  const hardRescan = async () => {
    if (!window.confirm('Hard rescan clears all dismissals and reruns AI from scratch. Continue?')) return;
    const ok = await applySnap(() => api.hardScan(), 'Hard rescan complete — fresh AI analysis.', 'hard');
    if (ok) {
      setCur(0);
      setAppliedLines({});
      setInlineEdits({});
    }
  };

  useEffect(() => {
    if (tutorialActive || figmaOpen || shortcutsOpen || searchOpen) return;
    const h = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'f' && drift && canApplyThis) { e.preventDefault(); applyThis(); }
      if (e.key === 'a' && drift) { e.preventDefault(); applyAll(); }
      if (e.key === 'd' && drift) { e.preventDefault(); dismiss(); }
      if (e.key === 'g') { e.preventDefault(); setGroupMode((v) => !v); setCur(0); }
      if (e.key === 'm') { e.preventDefault(); setHeatmapOn((v) => !v); }
      if (e.key === 'h') { e.preventDefault(); setShortcutsOpen((v) => !v); }
      if (e.key === '/') { e.preventDefault(); setSearchOpen(true); }
      if (e.key === 'Escape') { setShortcutsOpen(false); setSearchOpen(false); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  const applyFix = async (ids, overrides) => {
    const pulse = drift ? new Set(spotlightSelectorsFromDrift(drift)) : new Set();
    const edits = collectAppliedEdits(ids);
    if (Object.keys(edits).length) {
      setAppliedLines(edits);
      setApplying(true);
    }
    setBusy(true);
    const next = await api.fix(active.id, ids ?? null, overrides);
    setD(next);
    setBusy(false);
    setApplying(false);
    setInlineEdits({});
    bumpPreview();
    if (pulse.size) {
      setPulseSelectors(pulse);
      setTimeout(() => setPulseSelectors(new Set()), 2500);
    }
    if (N > 1) {
      setTimeout(() => go(1), 800);
    }
  };
  const applyThis = () => {
    if (!canApplyThis) return;
    const overrides = {};
    if (drift && Object.keys(inlineEdits).length) {
      overrides[drift.id] = { ...inlineEdits };
    }
    applyFix([drift.id], Object.keys(overrides).length ? overrides : undefined);
  };
  const applyAll = () => applyFix(null);
  const applyGroup = () => { if (applicableGroupIds.length) applyFix(applicableGroupIds); };
  const askAgent = async () => {
    const text = agentPrompt(active, drift);
    try { await navigator.clipboard.writeText(text); flash('Prompt copied — paste into your agent.'); }
    catch { flash('Copy blocked; logged to console.'); console.log(text); }
  };
  const revert = async () => { setBusy(true); setD(await api.revert(active.id)); setCur(0); setAppliedLines({}); setBusy(false); bumpPreview(); };
  const revertAll = async () => {
    setBusy(true);
    setD(await api.revertAll());
    setCur(0);
    setAppliedLines({});
    setBusy(false);
    bumpPreview();
  };
  const dismiss = () => {
    if (!active || !drift) return;
    const driftId = drift.id;
    const pageId = active.id;
    setD((prev) => {
      if (!prev) return prev;
      const pages = prev.pages.map((p) => {
        if (p.id !== pageId) return p;
        const drifts = p.drifts.filter((x) => x.id !== driftId).map((x, i) => ({ ...x, id: i + 1 }));
        return { ...p, drifts };
      });
      return { ...prev, pages, dismissed: (prev.dismissed ?? 0) + 1 };
    });
    setCur((c) => Math.max(0, Math.min(c, (drifts.length - 2))));
    flash('Dismissed.');
    api.dismiss(pageId, driftId).then(setD).catch(() => {});
  };
  const restore = async () => { setBusy(true); setD(await api.restore()); setBusy(false); };
  const handleInlineEdit = (line, val, open) => {
    if (open === true) setEditLine(line);
    if (open === false) setEditLine(null);
    setInlineEdits((prev) => ({ ...prev, [line]: val }));
  };

  const jumpHistory = (h) => {
    if (h.pageId) setActiveId(h.pageId);
    flash(`Jumped to ${h.action} on ${h.pageName || h.pageId}`);
  };

  const copyCliLink = async () => {
    const cmd = d?.deepLink?.cli || 'penny view';
    try { await navigator.clipboard.writeText(cmd); flash('CLI command copied.'); }
    catch { flash(cmd); }
  };
  const finishTutorial = async () => {
    setTutorialActive(false);
    setGroupMode(false);
    setHeatmapOn(false);
    setCur(0);
    localStorage.setItem(TUTORIAL_STORAGE, '1');
    setD(await api.config({ tutorialComplete: true }));
  };
  const startTutorial = () => { setTutorialStep(0); setGroupMode(false); setHeatmapOn(false); setTutorialActive(true); };
  const tutorialNext = () => {
    if (tutorialStep >= TUTORIAL_STEPS.length - 1) finishTutorial();
    else setTutorialStep((s) => s + 1);
  };
  const tutorialBack = () => setTutorialStep((s) => Math.max(0, s - 1));

  useEffect(() => {
    if (!tutorialActive) return;
    const demo = TUTORIAL_STEPS[tutorialStep]?.demo;
    if (demo === 'map') {
      setHeatmapOn(true);
      setGroupMode(false);
    } else if (demo === 'group') {
      setGroupMode(true);
      setHeatmapOn(false);
      setCur(0);
    } else {
      setHeatmapOn(false);
      setGroupMode(false);
    }
  }, [tutorialStep, tutorialActive]);

  useEffect(() => {
    if (!figmaOpen) return;
    const h = (e) => { if (e.key === 'Escape') setFigmaOpen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [figmaOpen]);

  if (!d) return <div className="p-8" style={{ color: paper(0.6) }}>Loading…</div>;
  if (!d.onboardingComplete) return <SetupGate />;
  if (d.loadError && !pages.length) {
    return (
      <div className="flex flex-col items-center justify-center h-screen px-6 text-center">
        <img src="/logo.png" alt="penny" className="h-10 w-auto mb-8" style={{ mixBlendMode: 'screen' }} />
        <h1 className="text-xl font-semibold mb-3" style={{ color: paper(0.95) }}>Dashboard reconnecting…</h1>
        <p className="text-sm mb-6 max-w-md leading-relaxed" style={{ color: paper(0.55) }}>
          {d.loadError}. If this persists, restart the server with <span className="mono">penny view</span> and refresh.
        </p>
        <button type="button" onClick={() => api.state().then(setD).catch(() => {})} className="px-4 py-2 rounded text-sm" style={{ background: paper(0.08), border: `1px solid ${paper(0.2)}`, color: paper(0.85) }}>Retry</button>
      </div>
    );
  }

  if (!active) return <div className="p-8" style={{ color: paper(0.6) }}>Loading…</div>;

  const scanOverlay = busy && scanMode ? <ScanOverlay mode={scanMode} aiLive={d?.aiLive} /> : null;

  if (totalDrifts === 0) {
    return (
      <>
        {scanOverlay}
        <div className="enter max-w-[900px] mx-auto p-6">
        <header className="flex items-center gap-3 mb-6">
          <img src="/logo.png" alt="penny" className="h-7 w-auto" style={{ mixBlendMode: 'screen' }} />
        </header>
        <SuccessState onRescan={rescan} busy={busy} scanNudge={d.scanNudge} driftScore={d.driftScore} />
        </div>
      </>
    );
  }

  const elementChips = spotSelectors;
  const sev = drift?.severity;
  const codeTitle = `${active.srcFile}${Object.keys(appliedLines).length ? ' · applied' : drift ? (curPlan ? ' · fix preview' : ' · advisory') : ''}`;

  return (
    <>
      {scanOverlay}
      <div className="enter flex flex-col w-full h-screen overflow-hidden">
      <div className="w-full px-5 pt-3 pb-2 shrink-0" data-tutorial="summary">
        <SummaryBar
          drifts={allDrifts} sevFilter={sevFilter} onFilter={setSevFilter} onRescan={rescan} onHardRescan={hardRescan}
          onFigma={d.frame?.embedUrl ? () => setFigmaOpen(true) : null} onTutorial={startTutorial} busy={busy}
          driftScore={d.driftScore} scanNudge={d.scanNudge}
          groupMode={groupMode} onGroup={() => { setGroupMode((v) => !v); setCur(0); }}
          heatmapOn={heatmapOn} onHeatmap={() => setHeatmapOn((v) => !v)}
          tokenCount={d.tokens?.length ?? 0} tokenMode={d.tokenMode} scanMode={d.scanMode}
          demoMode={d.demoMode} aiLive={d.aiLive}
          onCopyCli={copyCliLink} onShortcuts={() => setShortcutsOpen(true)}
        />
      </div>
      <FigmaModal frame={d.frame} open={figmaOpen} onClose={() => setFigmaOpen(false)} />

      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* LEFT HALF: rendered page, edge to center divider */}
        <div className="flex flex-col min-w-0 min-h-0 shrink-0 sync-now" data-tutorial="preview" style={{ width: '50%', borderRight: `1px solid ${paper(0.14)}`, ...panelSyncStyle('preview', sync, drift) }}>
          <div className="flex shrink-0 flex-wrap items-center w-full" style={{ borderBottom: `1px solid ${paper(0.1)}`, background: paper(0.03) }}>
            {pages.map((p) => (
              <button key={p.id} onClick={() => setActiveId(p.id)} className="px-4 py-2.5 text-xs"
                style={p.id === active.id ? { background: paper(0.1), color: paper(0.95), borderBottom: `2px solid ${paper(0.9)}` } : { color: paper(0.5) }}>
                {p.name}{(p.drifts?.length ?? 0) > 0 && ` (${p.drifts.length})`}{p.dirty && <span style={{ color: '#82d69a' }}> ●</span>}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5 pr-2">
              <button type="button" onClick={bumpPreview} disabled={busy} className="p-1.5 rounded disabled:opacity-40" style={{ color: paper(0.55), border: `1px solid ${paper(0.12)}` }} title="Refresh preview">
                <RefreshIcon />
              </button>
              <span className="px-2 py-2.5 text-[11px]" style={{ color: paper(0.4) }}>{active.srcFile}{active.previewKind && ` · ${previewKindLabel(active.previewKind)}`}</span>
            </div>
          </div>
          <div className="flex-1 min-h-0 w-full bg-white relative">
            <RenderedWindow iframeRef={previewIframeRef} page={active} highlightDrift={drift} mapOn={heatmapOn} pulseSelectors={pulseSelectors} refreshKey={previewRefresh} />
            <DriftMapOverlay iframeRef={previewIframeRef} markers={mapMarkers} visible={heatmapOn} contentKey={previewContentKey} />
            {heatmapOn && <span className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded z-10" style={{ background: 'rgba(17,17,17,0.7)', color: paper(0.8) }}>Drift map</span>}
          </div>
          {elementChips.length > 0 && (
            <div className="px-4 py-2 flex flex-wrap gap-1 shrink-0 w-full" style={{ borderTop: `1px solid ${paper(0.1)}`, background: paper(0.03) }}>
              <span className="text-[10px] self-center mr-1" style={{ color: paper(0.4) }}>Affected:</span>
              {elementChips.map((s) => (
                <button key={s} onClick={() => jumpToSelector(s)} className="px-1.5 py-0.5 rounded text-[10px] mono sync-now" style={{
                  background: curSelectors.has(s) ? syncBg(sev) : paper(0.05),
                  color: paper(0.75),
                  outline: sync.source === 'selector' && sync.id === s ? syncOutline(sev, true) : curSelectors.has(s) ? syncOutline(sev) : 'none',
                  outlineOffset: -1,
                }}>{s}</button>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT HALF: two columns, locked to viewport height */}
        <div className="grid grid-cols-2 gap-2 min-w-0 min-h-0 p-2 h-full overflow-hidden" style={{ width: '50%' }}>
          <div className="flex flex-col gap-2 min-h-0 h-full overflow-hidden">
            <div data-tutorial="tokens" className="min-h-0 flex flex-col sync-now" style={{ flex: '1 1 0', minHeight: 210, display: 'flex', flexDirection: 'column', overflow: 'hidden', ...panelSyncStyle('tokens', sync, drift) }}>
              <Win title="Tokens Found" className="min-h-0 flex-1" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div className="flex-1 min-h-0 overflow-y-auto"><TokenPanel tokens={d.tokens ?? []} activeName={drift?.token?.name} problemNames={problemTokens} onPick={jumpToToken} syncSource={sync.source} syncId={sync.id} severity={sev} /></div>
              </Win>
            </div>
            {drift && (drift.type === 'color' || drift.type === 'spacing' || drift.type === 'typography') && (
              <div data-tutorial="cinema">
                <Win title="Design vs Shipped" style={{ flexShrink: 0, overflow: 'hidden' }}>
                  <Cinema drift={drift} />
                </Win>
              </div>
            )}
            <div data-tutorial="problems" className="min-h-0 flex flex-col sync-now" style={{ flex: '0 0 32%', minHeight: 110, maxHeight: '34%', overflow: 'hidden', ...panelSyncStyle('problems', sync, drift) }}>
              <Win title="Problems · ↑↓ to cycle" className="min-h-0 flex-1" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <ProblemPanel n={idx} total={N} drift={drift} onPrev={() => go(-1)} onNext={() => go(1)} groupLabel={currentGroup?.label} />
                </div>
              </Win>
            </div>
          </div>
          <div className="flex flex-col gap-2 min-h-0 h-full overflow-hidden">
            <div data-tutorial="code" className="min-h-0 flex flex-col sync-now" style={{
              flex: '1 1 0', minHeight: 280, overflow: 'hidden',
              ...panelSyncStyle('code', sync, drift),
              ...(Object.keys(appliedLines).length ? { boxShadow: `inset 0 0 0 3px ${DIFF.appliedBorder}`, transition: 'none' } : {}),
            }}>
              <Win title={codeTitle} className="min-h-0 flex-1" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div className="flex-1 min-h-0 px-1 py-1"><CodeView src={active.src} scrollLine={scrollLine} curLines={curLines} lineSev={lineSev} edits={editByLine} appliedLines={appliedLines} onLine={jumpToLine} syncSource={sync.source} syncId={sync.id} severity={sev} inlineEdit={!!curPlan} onInlineEdit={handleInlineEdit} editLine={editLine} /></div>
              </Win>
            </div>
            <div data-tutorial="fix" className="shrink-0"><FixPanel active={active} drift={drift} plan={plan} curPlan={curPlan} busy={busy} applying={applying} agentName={d?.agent} onApplyThis={applyThis} onApplyAll={applyAll} onApplyGroup={applyGroup} onAsk={askAgent} onDismiss={dismiss} onRestore={restore} onRevert={revert} dismissed={d.dismissed ?? 0} groupCount={groupDriftIds.length} groupApplicable={applicableGroupIds.length} /></div>
            <HistoryPanel history={d.history} onJump={jumpHistory} />
            <Win title="Files · click to ignore" className="min-h-0" style={{ flex: '0 0 14%', minHeight: 60, maxHeight: '16%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
                {(d.files ?? []).map((f) => (
                  <button key={f.id} onClick={() => { setBusy(true); api.exclude(f.src).then(setD).finally(() => setBusy(false)); }} className="hl w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left" style={{ background: paper(0.05), opacity: f.excluded ? 0.45 : 1 }}>
                    <span className="mono">{f.name}</span>
                    <span className="ml-auto" style={{ color: paper(0.4) }}>{f.excluded ? 'ignored' : 'scanning'}</span>
                  </button>
                ))}
              </div>
            </Win>
          </div>
        </div>
      </div>
      {tutorialActive && (
        <TutorialOverlay step={tutorialStep} onNext={tutorialNext} onBack={tutorialBack} onSkip={finishTutorial} />
      )}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      {searchOpen && (
        <div className="fixed inset-0 z-[9994] flex items-start justify-center pt-24 p-6" style={{ background: 'rgba(17,17,17,0.6)' }} onClick={() => setSearchOpen(false)}>
          <div className="rounded-xl p-4 w-full max-w-md" style={{ background: '#1a1a1a', border: `1px solid ${paper(0.2)}` }} onClick={(e) => e.stopPropagation()}>
            <input autoFocus value={searchQ} onChange={(e) => { setSearchQ(e.target.value); setCur(0); }} placeholder="Search by token, selector, category…" className="w-full text-sm px-3 py-2 rounded bg-transparent outline-none" style={{ border: `1px solid ${paper(0.2)}`, color: paper(0.9) }} />
          </div>
        </div>
      )}
      <div className="fixed bottom-6 left-1/2 px-4 py-2 rounded-lg text-sm" style={{
        background: paper(1), color: '#111', pointerEvents: 'none', transform: `translate(-50%, ${toast.show ? '0px' : '10px'})`, opacity: toast.show ? 1 : 0,
        transition: 'opacity 200ms ease-out, transform 200ms ease-out',
      }}>{toast.msg}</div>
    </div>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
