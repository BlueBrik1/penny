// Reject or resolve AI fix placeholders — every apply must be valid source code.

const PLACEHOLDER_RE = /(?:^|\[|\(|['"`])?(?:TOKEN(?:_NAME|_VALUE)?|YOUR_[A-Z0-9_]+|INSERT_[A-Z0-9_]+|REPLACE_WITH|CANONICAL(?:_VALUE)?|TBD|FIXME|XXX|<[A-Z_]+>)(?:\]|['"`\)]|$)/i;

/** True when a string is a placeholder, not a literal value safe to apply. */
export function isPlaceholderValue(value) {
  const s = String(value ?? '').trim();
  if (!s) return true;
  if (PLACEHOLDER_RE.test(s)) return true;
  if (/^TOKEN_NAME$/i.test(s)) return true;
  if (/^\[?[A-Z][A-Z0-9_]{2,}\]?$/.test(s) && !/^#[0-9A-Fa-f]{3,8}$/.test(s)) return true;
  return false;
}

export function lineHasPlaceholders(line) {
  return isPlaceholderValue(line) || PLACEHOLDER_RE.test(String(line || ''));
}

/** Pick a concrete literal from expected, drift token, or token inventory. */
export function resolveConcreteValue({
  expected,
  token,
  panelTokens = [],
  found = [],
  type = 'color',
  find = '',
  message = '',
}) {
  const candidates = [];
  if (expected != null && !isPlaceholderValue(expected)) candidates.push(String(expected).trim());
  if (token?.value && !isPlaceholderValue(token.value)) candidates.push(String(token.value).trim());
  if (token?.name) {
    const byName = panelTokens.find((t) => t.name === token.name);
    if (byName?.value && !isPlaceholderValue(byName.value)) candidates.push(String(byName.value).trim());
  }
  if (candidates.length) return candidates[0];

  const msg = String(message).toLowerCase();
  const wantLight = /\b(light|lighter|bright|brighter|pale|white)\b/.test(msg);
  const wantDark = /\b(dark|darker|dim|muted)\b/.test(msg);
  const prefix = String(find).match(/^([a-z]+(?:-[a-z]+)?)-\[/)?.[1] || '';

  const pool = panelTokens.filter((t) => t?.value && !isPlaceholderValue(t.value));
  let filtered = pool;
  if (type === 'color' || prefix.startsWith('text') || prefix.startsWith('bg') || prefix.startsWith('border')) {
    filtered = pool.filter((t) => t.type === 'color' || String(t.value).startsWith('#') || /^rgb/i.test(String(t.value)));
  } else if (type === 'spacing' || /^p-|^m-|^gap-/.test(prefix)) {
    filtered = pool.filter((t) => t.type === 'spacing' || /px$/.test(String(t.value)));
  } else if (type === 'typography') {
    filtered = pool.filter((t) => t.type === 'typography' || /px$/.test(String(t.value)));
  }

  const nameHints = [];
  if (prefix.startsWith('text')) nameHints.push(/text|foreground|content|primary|body/i);
  if (prefix.startsWith('bg')) nameHints.push(/bg|background|surface|fill/i);
  if (prefix.startsWith('border')) nameHints.push(/border|stroke|outline/i);
  for (const re of nameHints) {
    const hit = filtered.find((t) => re.test(t.name || ''));
    if (hit) return String(hit.value).trim();
  }

  if (filtered.length === 1) return String(filtered[0].value).trim();

  if ((type === 'color' || prefix.startsWith('text') || prefix.startsWith('bg')) && filtered.length > 1) {
    const scored = filtered.map((t) => ({ t, lum: colorLuminance(String(t.value)) }))
      .sort((a, b) => a.lum - b.lum);
    if (wantLight) return String(scored[scored.length - 1].t.value).trim();
    if (wantDark) return String(scored[0].t.value).trim();
  }

  if (filtered[0]) return String(filtered[0].value).trim();
  return null;
}

function colorLuminance(value) {
  const hex = String(value).match(/#([0-9a-f]{6}|[0-9a-f]{3})/i)?.[1];
  if (!hex) return 0.5;
  const h = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Turn a concrete literal into the correct in-file fragment (Tailwind arb or plain). */
export function materializeReplace(find, concrete) {
  if (!concrete || isPlaceholderValue(concrete)) return null;
  const f = String(find || '');
  const c = String(concrete).trim();
  if (!f) return c;
  const prefixMatch = f.match(/^([a-z]+(?:-[a-z]+)?)-\[/);
  if (prefixMatch && (c.startsWith('#') || /^-?\d/.test(c) || c.endsWith('px') || c.endsWith('rem'))) {
    return `${prefixMatch[1]}-[${c}]`;
  }
  if (f.includes('[') && !c.includes('[') && (c.startsWith('#') || /^-?\d/.test(c))) {
    const prefix = f.slice(0, f.indexOf('['));
    return `${prefix}[${c}]`;
  }
  return c;
}

/** Normalize one AI edit — resolve placeholders, rebuild after line, or drop if still invalid. */
export function sanitizeCreativeEdit(edit, ctx = {}) {
  const lines = ctx.lines || [];
  let line = Number(edit.line);
  let before = edit.before != null ? String(edit.before) : '';
  let find = edit.find != null ? String(edit.find) : '';
  let replace = edit.replace != null ? String(edit.replace) : '';
  let after = edit.after != null ? String(edit.after) : '';

  if (!line || line < 1 || line > lines.length) return null;
  if (!before) before = lines[line - 1] ?? '';
  if (!find && ctx.found?.[0]) find = ctx.found[0];

  const needsResolve = isPlaceholderValue(replace) || lineHasPlaceholders(after) || lineHasPlaceholders(replace);
  const concrete = resolveConcreteValue({
    expected: ctx.expected,
    token: ctx.token,
    panelTokens: ctx.panelTokens,
    found: ctx.found,
    type: ctx.type,
    find,
    message: ctx.message,
  });

  if (needsResolve) {
    if (!concrete) return null;
    replace = materializeReplace(find, concrete);
    if (!replace || isPlaceholderValue(replace)) return null;
    if (find && before.includes(find)) after = before.replace(find, replace);
    else return null;
  }

  if (!after && find && replace && before.includes(find)) after = before.replace(find, replace);
  if (!after || after === before) return null;
  if (lineHasPlaceholders(after) || lineHasPlaceholders(replace)) return null;

  return { line, before, after, find, replace, file: edit.file };
}
