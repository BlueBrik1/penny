// Page + element scoped dismissals — suppress similar AI suggestions without muting the whole codebase.

import { normalizeSpotSelector } from './interactive.js';
import { driftKey } from './fixer.js';

/** Stable element identity within a page (survives rescans better than drift id). */
export function elementIdentity(drift) {
  const loc = drift.locations?.[0];
  const raw = (
    loc?.highlight
    || drift.highlight
    || drift.elementName
    || loc?.elementName
    || normalizeSpotSelector(loc?.selector || '')
    || (loc?.line ? `line:${loc.line}` : '')
  );
  return String(raw || 'unknown').toLowerCase().trim();
}

export function recordDismissItem(pageId, drift) {
  return {
    pageId,
    element: elementIdentity(drift),
    elementName: drift.elementName || drift.locations?.[0]?.elementName || '',
    category: drift.category || '',
    type: drift.type || '',
    token: drift.token?.name || '',
  };
}

function itemSig(item) {
  return `${item.pageId}|${item.element}|${item.category}|${item.type}|${item.token || ''}`;
}

export function appendDismissItem(cfg, item) {
  const list = [...(cfg.dismissedItems || [])];
  const sig = itemSig(item);
  if (!list.some((x) => itemSig(x) === sig)) list.push(item);
  return list;
}

export function dismissedItemsForPage(pageId, items = []) {
  return items.filter((i) => i.pageId === pageId);
}

/** True when this drift matches a user dismissal on the same page + element + issue kind. */
export function isSimilarDismissed(pageId, drift, items = []) {
  const el = elementIdentity(drift);
  const cat = drift.category || '';
  const typ = drift.type || '';
  const tok = drift.token?.name || '';

  for (const item of items) {
    if (item.pageId !== pageId) continue;
    if (item.element !== el) continue;
    if (item.category !== cat || item.type !== typ) continue;
    if (item.token && tok && item.token !== tok) continue;
    return true;
  }
  return false;
}

/** Post-filter + legacy driftKey support for older configs. */
export function isDismissed(pageId, drift, cfg = {}) {
  const legacy = new Set(cfg.dismissed || []);
  if (legacy.has(driftKey(drift))) return true;
  return isSimilarDismissed(pageId, drift, cfg.dismissedItems || []);
}

export function dismissedCount(cfg = {}) {
  return (cfg.dismissedItems || []).length + (cfg.dismissed || []).length;
}

export function formatDismissedForPrompt(items = []) {
  if (!items.length) return '';
  const lines = items.map((i) => {
    const label = i.elementName || i.element;
    const token = i.token ? ` token ${i.token}` : '';
    return `- ${label} (${i.category}, ${i.type}${token}) — user dismissed; do NOT report the same or similar issue for this element again.`;
  });
  return [
    '\n--- USER DISMISSED ON THIS PAGE (never re-report for these elements) ---',
    ...lines,
    '',
  ].join('\n');
}
