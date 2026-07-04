// Drift map — paint dashed overlays inside the preview iframe (same document as elements).

import { highlightLocations, normalizeSpotSelector } from './interactive.js';

const GENERIC_SKIP = new Set(['body', 'html', ':root']);
const SEV_COLOR = { high: '#e5484d', medium: '#f5a623', low: '#4c9be8' };
const LAYER_ID = 'penny-drift-map';

/** Resolve one location to a query the preview can run. */
export function mapTargetFromLocation(loc) {
  if (loc.syntax?.kind === 'tw-arb' || loc.syntax?.kind === 'tw-space') {
    const raw = loc.highlight || loc.raw || '';
    return raw ? { kind: 'classContains', value: raw } : null;
  }
  const sel = normalizeSpotSelector(loc.highlight || loc.selector);
  if (!sel || GENERIC_SKIP.has(sel)) {
    const raw = loc.raw || loc.value;
    if (raw && /\[|bg-|text-|p-|m-|gap-/.test(raw)) return { kind: 'classContains', value: raw };
    return null;
  }
  return { kind: 'selector', value: sel };
}

export function findElementsInDoc(doc, marker) {
  if (!doc || !marker) return [];
  if (marker.kind === 'classContains') {
    const esc = marker.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    try { return [...doc.querySelectorAll(`[class*="${esc}"]`)]; } catch { return []; }
  }
  try { return [...doc.querySelectorAll(marker.value)]; } catch { return []; }
}

/** Flat marker list for one or more drifts (wrong-value locations only). */
export function collectMapMarkers(drifts) {
  if (!drifts?.length) return [];
  const multi = drifts.length > 1;
  const markers = [];
  drifts.forEach((d, driftIdx) => {
    const color = SEV_COLOR[d.severity] || '#888';
    const label = multi ? String(driftIdx + 1) : '●';
    for (const loc of highlightLocations(d)) {
      const target = mapTargetFromLocation(loc);
      if (!target) continue;
      const badgeLabel = loc.elementName && !multi ? loc.elementName.slice(0, 12) : label;
      markers.push({ ...target, color, label: badgeLabel, driftId: d.id, elementName: loc.elementName });
    }
  });
  return markers;
}

export function clearMapInIframe(doc) {
  try { doc?.getElementById(LAYER_ID)?.remove(); } catch { /* ignore */ }
}

/** Paint markers inside the iframe — fixed coords from each element's getBoundingClientRect. */
export function renderMapInIframe(doc, markers) {
  clearMapInIframe(doc);
  if (!doc?.body || !markers?.length) return;
  const layer = doc.createElement('div');
  layer.id = LAYER_ID;
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:visible';
  const seen = new WeakSet();
  for (const m of markers) {
    for (const el of findElementsInDoc(doc, m)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const box = doc.createElement('div');
      box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:2px dashed ${m.color};border-radius:4px;box-sizing:border-box;pointer-events:none;`;
      layer.appendChild(box);
      const badge = doc.createElement('div');
      badge.textContent = m.label;
      badge.style.cssText = `position:fixed;left:${r.right - 4}px;top:${r.top - 10}px;min-width:16px;height:16px;padding:0 3px;background:${m.color};color:#fff;font:bold 10px/16px system-ui,sans-serif;border-radius:999px;text-align:center;pointer-events:none;`;
      layer.appendChild(badge);
    }
  }
  if (layer.childNodes.length) doc.body.appendChild(layer);
}

/** Scroll the preview document so the first highlighted drift element is centered. */
export function scrollDriftIntoView(doc, drift) {
  if (!doc || !drift) return;
  for (const loc of highlightLocations(drift)) {
    const target = mapTargetFromLocation(loc);
    if (!target) continue;
    const el = findElementsInDoc(doc, target)[0];
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
  }
}
