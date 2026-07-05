// CSS fix engine: turns drift findings into concrete line edits and applies them.
import { lineHasPlaceholders } from './concrete-fix.js';
// Pure and testable — the three UI fix modes (auto / plan / accept-edits) are just
// different policies over computeFixPlan() + applyPlan().
//
// Auto-fixable = value-drift and inconsistent-usage. off-palette/off-scale are advisory.

export function isFixable(drift) {
  return drift.category === 'value-drift' || drift.category === 'inconsistent-usage';
}

/** True when a plan item rewrites at least one source line (before !== after). */
export function hasApplicableEdits(planItem) {
  return !!planItem?.edits?.some((e) => e.before !== e.after);
}

// Stable-ish identity for a drift so a dismissal survives re-scans (the numeric id does
// not — it's just the post-sort index). Keyed on what the drift *is*, not where it ranks.
export function driftKey(d) {
  const file = d.locations?.[0]?.file || '';
  return [file, d.category, d.type, d.token?.name || '', [...(d.actualValues || [])].sort().join('|')].join('::');
}

// The canonical literal we write into the CSS (typography/spacing use the px value,
// not the rich label).
export function canonicalValue(drift) {
  return drift.expected;
}

// Render the canonical value back into the location's own design language, so a Tailwind
// class stays a Tailwind class and CSS stays CSS.
export function renderCanonical(loc, drift) {
  const syntax = loc.syntax || { kind: 'css' };
  const canonical = drift.expected; // '#ff6b35' | '16px'
  if (syntax.kind === 'tw-arb') return `${syntax.prefix}-[${canonical}]`;
  if (syntax.kind === 'tw-space') {
    const px = parseFloat(canonical);
    return px % 4 === 0 ? `${syntax.prefix}-${px / 4}` : `${syntax.prefix}-[${canonical}]`;
  }
  return canonical; // plain CSS
}

// Deterministic before/after edits for a fixable drift, resolved against `src`.
// Same rule the fix engine already uses (locations + renderCanonical), but with the
// before/after lines materialized so the drift can carry them in `aiEdits` for the UI.
export function buildDeterministicEdits(drift, src) {
  if (drift.aiEdits?.length || !isFixable(drift)) return [];
  const lines = src.split('\n');
  return (drift.locations || [])
    .map((l) => {
      const find = l.raw ?? l.value;
      const replace = renderCanonical(l, drift);
      if (find === replace) return null;
      const before = lines[l.line - 1] ?? '';
      const after = before.replace(find, replace);
      if (before === after) return null;
      return { line: l.line, find, replace, before, after, selector: l.selector, file: l.file };
    })
    .filter(Boolean);
}

// Build the per-location edits for one drift: prefer AI-provided edits, else deterministic.
function editsForDrift(drift) {
  if (drift.aiEdits?.length) {
    return drift.aiEdits.map((e) => ({
      line: e.line,
      find: e.find ?? '',
      replace: e.replace ?? '',
      before: e.before,
      after: e.after,
      selector: e.selector,
      file: e.file,
    })).filter((e) => e.before !== e.after && !lineHasPlaceholders(e.after) && !lineHasPlaceholders(e.replace));
  }
  if (!isFixable(drift)) return [];
  return drift.locations
    .map((l) => ({ line: l.line, find: l.raw ?? l.value, replace: renderCanonical(l, drift), selector: l.selector, file: l.file }))
    .filter((e) => e.find !== e.replace);
}

// css + drifts -> [{ id, token, category, edits:[{line, find, replace, before, after}] }]
export function computeFixPlan(css, drifts) {
  const lines = css.split('\n');
  const plan = [];
  for (const d of drifts) {
    if (d.applied) continue;
    const edits = editsForDrift(d).map((e) => {
      if (e.before != null && e.after != null) return { ...e };
      const before = lines[e.line - 1] ?? '';
      const after = before.replace(e.find, e.replace);
      return { ...e, before, after };
    });
    if (edits.length) plan.push({ id: d.id, token: d.token?.name, category: d.category, type: d.type, edits });
  }
  return plan;
}

// Apply the plan (optionally only for `acceptedIds`) to the CSS text. Edits may carry an
// `override` replacement (accept-edits "edit" action). Returns the new CSS string.
export function applyPlan(css, plan, acceptedIds = null) {
  const lines = css.split('\n');
  let changed = false;
  for (const item of plan) {
    if (acceptedIds && !acceptedIds.includes(item.id)) continue;
    for (const e of item.edits) {
      const i = e.line - 1;
      if (i < 0 || i >= lines.length) continue;
      const line = lines[i];
      const after = e.override ?? e.after;
      if (after != null && e.before != null && line === e.before) {
        if (line !== after) {
          lines[i] = after;
          changed = true;
        }
        continue;
      }
      const find = e.find ?? '';
      const replace = e.override ?? e.replace ?? after;
      if (find && line.includes(find) && replace != null) {
        const next = line.replace(find, replace);
        if (next !== line) {
          lines[i] = next;
          changed = true;
        }
        continue;
      }
      if (after != null && line !== after && e.before != null && line.trim() === e.before.trim()) {
        lines[i] = after;
        changed = true;
      }
    }
  }
  return changed ? lines.join('\n') : css;
}
