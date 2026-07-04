// Design-language-agnostic source parser. Dispatches by file extension:
//   .css/.scss/.less        -> postcss (parseCss)
//   .jsx/.tsx/.js/.ts/.html/.vue/.svelte -> markup scan (Tailwind classes + inline colors)
//
// Every usage carries the same shape the CSS parser emits, plus:
//   raw    - exact source text to match when rewriting
//   syntax - { kind, prefix? } so the fixer can render a canonical value back in-language
//
// Tailwind coverage (the common, unambiguous cases):
//   arbitrary values  bg-[#ff6b35]  text-[18px]  p-[10px]   -> color / typography / spacing
//   numeric scale     p-4 mt-6 gap-2 ...                    -> spacing (n * 4px)
// Named sizes (text-lg, rounded-xl) are intentionally left as advisory only.

import { parseCss } from './css.js';
import { normalizeColor } from './color.js';

export { parseCss };

const REM_BASE = 16;

// Tailwind spacing-family prefixes -> the CSS prop they stand in for (classification only).
const TW_SPACE_PREFIX = new Set([
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl',
  'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml',
  'gap', 'gap-x', 'gap-y', 'space-x', 'space-y', 'inset', 'top', 'right', 'bottom', 'left',
]);
// Prefixes whose arbitrary length means a font-size, not spacing.
const TW_TEXT_PREFIX = new Set(['text', 'leading']);

function lenToPx(numStr, unit) {
  const n = parseFloat(numStr);
  return unit === 'rem' ? n * REM_BASE : n;
}

// Extension -> parser.
export function parseSource(text, file = 'input') {
  const ext = (file.split('.').pop() || '').toLowerCase();
  if (ext === 'css' || ext === 'scss' || ext === 'less') return parseCss(text, file);
  return parseMarkup(text, file);
}

// Blank out comments (keeping newlines/positions) so hex/classes mentioned in prose
// aren't mistaken for real usages.
function blankComments(text) {
  const space = (m) => m.replace(/[^\n]/g, ' ');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, space)
    .replace(/<!--[\s\S]*?-->/g, space)
    .replace(/\/\/[^\n]*/g, space);
}

// Scan JSX/TSX/HTML/etc line-by-line for Tailwind utilities and inline color/length literals.
function parseMarkup(text, file) {
  const out = [];
  const lines = blankComments(text).split('\n');
  lines.forEach((line, i) => {
    const lineNo = i + 1;

    // 1) Arbitrary values: prefix-[value]
    for (const m of line.matchAll(/([a-zA-Z][\w-]*)-\[([^\]]+)\]/g)) {
      const [raw, prefix, inner] = m;
      const syntax = { kind: 'tw-arb', prefix };
      const base = { prop: prefix, selector: raw, file, line: lineNo, raw, syntax };
      const color = normalizeColor(inner);
      const len = /^(-?\d*\.?\d+)(px|rem)$/.exec(inner);
      if (color) {
        out.push({ ...base, type: 'color', value: color, color });
      } else if (len) {
        const px = lenToPx(len[1], len[2]);
        const type = TW_TEXT_PREFIX.has(prefix) ? 'typography' : 'spacing';
        out.push({ ...base, type, value: `${px}px`, px });
      }
    }

    // 2) Numeric spacing scale: prefix-N  (N in 0.5 steps -> N*4px)
    for (const m of line.matchAll(/(?:^|[\s"'`{])((?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y)-\d+(?:\.\d+)?)\b/g)) {
      const raw = m[1];
      const dash = raw.lastIndexOf('-');
      const prefix = raw.slice(0, dash);
      if (!TW_SPACE_PREFIX.has(prefix)) continue;
      const px = parseFloat(raw.slice(dash + 1)) * 4;
      if (px > 0) out.push({ prop: prefix, selector: raw, file, line: lineNo, raw, syntax: { kind: 'tw-space', prefix }, type: 'spacing', value: `${px}px`, px });
    }

    // 3) Inline color literals anywhere on the line (style props, hex/rgb attributes).
    for (const raw of line.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []) {
      // Skip ones already captured as a Tailwind arbitrary value on this line.
      if (line.includes(`[${raw}]`)) continue;
      const color = normalizeColor(raw);
      if (color) out.push({ prop: 'color', selector: raw, file, line: lineNo, raw, syntax: { kind: 'css' }, type: 'color', value: color, color });
    }
  });
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  // self-check: node src/parse.js
  const u = parseMarkup('<div className="bg-[#ff6b35] p-6 text-[18px]" style={{color:"#fff"}} />', 'x.jsx');
  const kinds = u.map((x) => `${x.type}:${x.raw}`).sort().join(',');
  const ok = kinds === 'color:#fff,color:bg-[#ff6b35],spacing:p-6,typography:text-[18px]';
  console.log(ok ? 'ok' : 'FAIL ' + kinds);
  if (!ok) process.exit(1);
}
