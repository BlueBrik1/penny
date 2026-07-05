// Shared interactivity helpers for web + CLI: score, grouping, explainers.

import { computeFixPlan, hasApplicableEdits } from './fixer.js';

export { hasApplicableEdits };

export const RANK = { high: 3, medium: 2, low: 1 };

export function computeDriftScore(pages, tokens) {
  const tokenCount = tokens?.length || 0;
  const drifts = (pages || []).flatMap((p) => p.drifts || []);
  if (!tokenCount) return { score: 100, aligned: 0, total: 0, driftCount: drifts.length };
  const driftedTokens = new Set(drifts.map((d) => d.token?.name).filter(Boolean));
  const aligned = tokenCount - driftedTokens.size;
  const score = Math.round(Math.max(0, Math.min(100, (aligned / tokenCount) * 100)));
  return { score, aligned, total: tokenCount, driftCount: drifts.length };
}

export function severityExplainer(drift) {
  if (!drift) return '';
  const sev = drift.severity;
  const cat = drift.category;
  const type = drift.type;
  if (sev === 'high') {
    if (type === 'color') return 'Brand or contrast-critical color — users see inconsistent UI immediately.';
    if (cat === 'inconsistent-usage') return 'Same token renders differently in multiple places — breaks design-system trust.';
    return 'Direct mismatch with a core design token — visible on primary UI surfaces.';
  }
  if (sev === 'medium') {
    if (type === 'spacing') return 'Spacing off the scale — layout rhythm diverges from Figma.';
    if (type === 'typography') return 'Type size/weight drift — readable but not on-system.';
    return 'Noticeable drift that compounds if left unfixed across pages.';
  }
  return 'Minor deviation — low user impact but adds noise to the token graph.';
}

export function groupDrifts(drifts, mode = 'token') {
  if (mode !== 'token') return drifts.map((d, i) => ({ key: String(i), label: `#${i + 1}`, drifts: [d], ids: [d.id] }));
  const map = new Map();
  for (const d of drifts) {
    const key = d.token?.name || d.category || 'misc';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(d);
  }
  return [...map.entries()].map(([key, list]) => ({
    key,
    label: key,
    drifts: list,
    ids: list.map((x) => x.id),
  }));
}

export function sortDriftsBySeverity(drifts) {
  return [...drifts].sort((a, b) => (RANK[b.severity] || 0) - (RANK[a.severity] || 0));
}

const GENERIC_SPOT_SKIP = new Set(['body', 'html', ':root']);

/** Tailwind utility substring — not valid for querySelector (e.g. bg-[#ff7038]). */
export function isTailwindClassFragment(value) {
  const s = String(value || '').trim();
  if (!s || /\s|[>,+~]/.test(s)) return false;
  if (/^\./.test(s) || /^#[a-z]/i.test(s)) return false;
  if (/\[/.test(s)) return true;
  return /^(?:bg|text|border|ring|outline|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space|rounded|font|flex|grid|w|h|top|left|right|bottom|z|opacity|shadow|items|justify|self|place|content|order|grow|shrink|basis|col|row|max|min|aspect|object|overflow|pointer|cursor|select|transition|duration|ease|scale|rotate|translate|skew|origin|backdrop|divide|from|via|to|fill|stroke|decoration|tracking|leading|line|list|table|break|whitespace|indent|align|hyphens)-/.test(s);
}

export function normalizeSpotSelector(selector) {
  return (selector || '').replace(/:{1,2}[a-z-]+(\([^)]*\))?/g, '').trim();
}

/** Locations that should visually highlight — skips exact token matches on splinter drifts. */
export function highlightLocations(drift) {
  if (!drift?.locations?.length) return [];
  const canonical = drift.expected ?? drift.token?.value ?? null;
  if (canonical != null && (drift.category === 'inconsistent-usage' || drift.category === 'value-drift')) {
    return drift.locations.filter((loc) => loc.value !== canonical);
  }
  return drift.locations;
}

function addSpotTarget(out, loc) {
  if (loc.syntax?.kind === 'tw-arb' || loc.syntax?.kind === 'tw-space') {
    const raw = loc.raw || loc.highlight || '';
    if (raw) out.add(raw);
    return;
  }
  const tw = loc.highlight || loc.raw || loc.selector || '';
  if (isTailwindClassFragment(tw)) {
    out.add(String(tw).replace(/^\./, ''));
    return;
  }
  const sel = normalizeSpotSelector(loc.highlight || loc.selector);
  if (sel && !GENERIC_SPOT_SKIP.has(sel)) {
    out.add(sel);
    return;
  }
  const raw = loc.raw || loc.value;
  if (raw && /\[|bg-|text-|p-|m-|gap-/.test(raw)) out.add(raw);
}

/** CSS/JSX selectors to spotlight for one drift (wrong usages only, no page-wide tags). */
export function spotlightSelectorsFromDrift(drift) {
  const out = new Set();
  const top = (drift?.highlight || '').trim();
  if (top && !/\s/.test(top)) out.add(top);
  for (const loc of highlightLocations(drift)) addSpotTarget(out, loc);
  return [...out];
}

export function buildHeatmapCss(pageDrifts) {
  const dots = [];
  pageDrifts.forEach((d, i) => {
    const color = { high: '#e5484d', medium: '#f5a623', low: '#4c9be8' }[d.severity] || '#888';
    const label = pageDrifts.length === 1 ? '●' : String(i + 1);
    for (const loc of highlightLocations(d)) {
      let sel;
      if (loc.syntax?.kind === 'tw-arb' || loc.syntax?.kind === 'tw-space') {
        const raw = loc.raw || '';
        if (!raw) continue;
        sel = `[class*="${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
      } else {
        sel = normalizeSpotSelector(loc.highlight || loc.selector);
        if (!sel || GENERIC_SPOT_SKIP.has(sel)) continue;
      }
      dots.push(`${sel} { outline: 2px dashed ${color} !important; outline-offset: 2px; position: relative; }`);
      if (label !== '●') {
        dots.push(`${sel}::after { content: '${label}'; position: absolute; top: -8px; right: -8px; background: ${color}; color: #fff; font: bold 10px system-ui; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; z-index: 300; }`);
      }
    }
  });
  return [...new Set(dots)].join('\n');
}

export function planForDrift(src, drift) {
  return computeFixPlan(src, [drift]).find((p) => p.id === drift.id) || null;
}

export function deepLinkCmd({ pageId, driftIdx }) {
  const parts = ['penny view'];
  if (pageId) parts.push(`--page=${pageId}`);
  if (driftIdx != null) parts.push(`--drift=${driftIdx}`);
  return parts.join(' ');
}

export function webDeepLink({ pageId, driftIdx, port = 5178 }) {
  const q = [];
  if (pageId) q.push(`page=${encodeURIComponent(pageId)}`);
  if (driftIdx != null) q.push(`drift=${driftIdx}`);
  return `http://localhost:${port}${q.length ? `?${q.join('&')}` : ''}`;
}

/** Pick which configured page owns a preview element (dev-server shows the whole app). Browser-safe. */
export function matchPageForElement(pages, element, fallbackId) {
  if (!element || !pages?.length) return { pageId: fallbackId, matched: false };
  const needles = [
    element.highlight,
    ...(element.classes || []).filter((c) => c.length > 3),
  ].filter(Boolean);
  if (!needles.length) return { pageId: fallbackId, matched: false };

  let bestId = fallbackId;
  let bestScore = 0;
  for (const p of pages) {
    const src = p.src || '';
    let score = 0;
    for (const n of needles) {
      if (src.includes(n)) score += n.length + 10;
    }
    if (element.text?.length > 3 && src.includes(element.text.slice(0, 24).trim())) score += 8;
    if (score > bestScore) {
      bestScore = score;
      bestId = p.id;
    }
  }
  return { pageId: bestScore > 0 ? bestId : fallbackId, matched: bestScore > 0 };
}

export function resolvePageForElement(pages, element, fallbackId) {
  return matchPageForElement(pages, element, fallbackId).pageId;
}
