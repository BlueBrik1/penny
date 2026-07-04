// Step 2: CSS parser.
// Walks authored CSS with postcss and extracts color / spacing / typography *usages*,
// each carrying its source location (file, line, selector) so the report can point at
// exactly where a drift lives.
//
// Usage shape:
//   { type: 'color'|'spacing'|'typography', value, color?|px?, prop, selector, file, line }

import postcss from 'postcss';

const REM_BASE = 16;

const SPACING_PROPS = new Set([
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'gap', 'row-gap', 'column-gap', 'border-radius', 'top', 'right', 'bottom', 'left',
]);

// Color literals anywhere in a value: hex, rgb(), rgba().
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
// Lengths in px or rem.
const LEN_RE = /(-?\d*\.?\d+)(px|rem)\b/g;

import { normalizeColor } from './color.js';

function lengthToPx(numStr, unit) {
  const n = parseFloat(numStr);
  return unit === 'rem' ? n * REM_BASE : n;
}

// Extract every usage from one declaration.
function usagesFromDecl(decl, file) {
  const out = [];
  const prop = decl.prop.toLowerCase();
  const line = decl.source?.start?.line ?? 0;
  const selector = decl.parent?.selector || decl.parent?.name || '';
  const base = { prop: decl.prop, selector, file, line };

  // `raw` is the exact source text to find when rewriting; `syntax` tells the fixer how
  // to render a canonical value back into this language (plain CSS here).
  const css = { kind: 'css' };

  // Colors — from any property whose value contains a color literal.
  for (const raw of decl.value.match(COLOR_RE) || []) {
    const color = normalizeColor(raw);
    if (color) out.push({ ...base, type: 'color', value: color, color, raw, syntax: css });
  }

  // Spacing — only from spacing-related properties, to avoid flooding on generic lengths.
  if (SPACING_PROPS.has(prop)) {
    for (const m of decl.value.matchAll(LEN_RE)) {
      const px = lengthToPx(m[1], m[2]);
      if (px > 0) out.push({ ...base, type: 'spacing', value: `${px}px`, px, raw: m[0], syntax: css });
    }
  }

  // Typography — font-size is the comparable anchor.
  if (prop === 'font-size') {
    const one = /(-?\d*\.?\d+)(px|rem)/.exec(decl.value);
    if (one) {
      const px = lengthToPx(one[1], one[2]);
      out.push({ ...base, type: 'typography', value: `${px}px`, px, raw: one[0], syntax: css });
    }
  }

  return out;
}

// css string -> usages[]. `file` is a label for reporting (e.g. the filename).
export function parseCss(css, file = 'input.css') {
  const root = postcss.parse(css, { from: file });
  const usages = [];
  root.walkDecls((decl) => {
    usages.push(...usagesFromDecl(decl, file));
  });
  return usages;
}
