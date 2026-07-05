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

function colorLuminance(value) {
  const hex = String(value).match(/#([0-9a-f]{6}|[0-9a-f]{3})/i)?.[1];
  if (!hex) return 0.5;
  const h = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function numericSize(value) {
  const s = String(value ?? '');
  const px = s.match(/(-?\d+(?:\.\d+)?)\s*px/i) || s.match(/\[(-?\d+(?:\.\d+)?)px\]/i);
  if (px) return parseFloat(px[1]);
  const rem = s.match(/(-?\d+(?:\.\d+)?)\s*rem/i);
  if (rem) return parseFloat(rem[1]) * 16;
  const bare = s.match(/^(-?\d+(?:\.\d+)?)$/);
  if (bare) return parseFloat(bare[1]);
  return null;
}

function currentColorFromContext(find, found = []) {
  const fromFind = String(find).match(/#([0-9a-f]{3,8})/i)?.[0];
  if (fromFind) return fromFind;
  const hit = found.find((v) => /^#([0-9a-f]{3,8})$/i.test(String(v)));
  return hit ? String(hit) : null;
}

function currentSizeFromContext(find, found = []) {
  const fromFind = numericSize(find);
  if (fromFind != null) return fromFind;
  for (const v of found) {
    const n = numericSize(v);
    if (n != null) return n;
  }
  return null;
}

function directionFlags(message) {
  const msg = String(message).toLowerCase();
  let wantLight = /\btoo dark\b/.test(msg);
  let wantDark = /\btoo light\b/.test(msg);
  if (!wantLight && !wantDark) {
    wantLight = /\b(light|lighter|bright|brighter|pale|white)\b/.test(msg);
    wantDark = /\b(dark|darker|dim|muted)\b/.test(msg);
  }
  const tooSmall = /\btoo small\b|\btoo tiny\b/.test(msg);
  const tooBig = /\btoo big\b|\btoo large\b/.test(msg);
  let wantBig = tooSmall || /\b(bigger|larger|wider|taller|huge)\b/.test(msg);
  let wantSmall = tooBig || /\b(smaller|tiny|narrow|shorter|tight)\b/.test(msg);
  if (!wantBig && !wantSmall) {
    if (/\b(big|large)\b/.test(msg)) wantBig = true;
    if (/\b(small|tiny)\b/.test(msg)) wantSmall = true;
  }
  return { wantLight, wantDark, wantBig, wantSmall };
}

function passesColorDirection(chosen, find, found, message) {
  const { wantLight, wantDark } = directionFlags(message);
  if (!wantLight && !wantDark) return true;
  const cur = currentColorFromContext(find, found);
  if (!cur) return true;
  const cLum = colorLuminance(chosen);
  const curLum = colorLuminance(cur);
  if (wantLight && cLum <= curLum) return false;
  if (wantDark && cLum >= curLum) return false;
  return true;
}

function passesSizeDirection(chosen, find, found, message) {
  const { wantBig, wantSmall } = directionFlags(message);
  if (!wantBig && !wantSmall) return true;
  const cur = currentSizeFromContext(find, found);
  const next = numericSize(chosen);
  if (cur == null || next == null) return true;
  if (wantBig && next <= cur) return false;
  if (wantSmall && next >= cur) return false;
  return true;
}

function pickColorByDirection(filtered, find, found, message) {
  const { wantLight, wantDark } = directionFlags(message);
  if (!wantLight && !wantDark) return null;
  const scored = filtered.map((t) => ({ t, lum: colorLuminance(String(t.value)) }))
    .sort((a, b) => a.lum - b.lum);
  const cur = currentColorFromContext(find, found);
  if (cur != null) {
    const curLum = colorLuminance(cur);
    if (wantLight) {
      const higher = scored.filter((x) => x.lum > curLum);
      return higher.length ? String(higher[higher.length - 1].t.value).trim() : null;
    }
    if (wantDark) {
      const lower = scored.filter((x) => x.lum < curLum);
      return lower.length ? String(lower[0].t.value).trim() : null;
    }
  }
  if (wantLight) return String(scored[scored.length - 1].t.value).trim();
  if (wantDark) return String(scored[0].t.value).trim();
  return null;
}

function pickSizeByDirection(filtered, find, found, message) {
  const { wantBig, wantSmall } = directionFlags(message);
  if (!wantBig && !wantSmall) return null;
  const scored = filtered.map((t) => ({ t, num: numericSize(String(t.value)) }))
    .filter((x) => x.num != null)
    .sort((a, b) => a.num - b.num);
  if (!scored.length) return null;
  const cur = currentSizeFromContext(find, found);
  if (cur != null) {
    if (wantBig) {
      const higher = scored.filter((x) => x.num > cur);
      return higher.length ? String(higher[0].t.value).trim() : null;
    }
    if (wantSmall) {
      const lower = scored.filter((x) => x.num < cur);
      return lower.length ? String(lower[lower.length - 1].t.value).trim() : null;
    }
  }
  if (wantBig) return String(scored[scored.length - 1].t.value).trim();
  if (wantSmall) return String(scored[0].t.value).trim();
  return null;
}

/** Infer property type from user complaint keywords. */
export function inferComplaintProperty(message) {
  const m = String(message).toLowerCase();
  if (/\b(color|colour|dark|light|bright|pale|hue|saturat|contrast|white|black)\b/.test(m)) return 'color';
  if (/\b(padding|margin|gap|spacing|space|cramped|loose)\b/.test(m)) return 'spacing';
  if (/\b(big|small|size|font|text|larger|smaller|tiny|huge|tall|wide)\b/.test(m)) return 'size';
  return null;
}

/** Infer which CSS property an edit changes. */
export function inferEditProperty(edit) {
  const blob = `${edit.find || ''} ${edit.replace || ''} ${edit.before || ''} ${edit.after || ''}`.toLowerCase();
  if (/(?:text|bg|border|fill|stroke)-\[#|(?:text|bg|border)-\[rgb|#[0-9a-f]{3,8}/i.test(blob)) return 'color';
  if (/(?:^|[\s"'`])(?:p-|px-|py-|pt-|pb-|pl-|pr-|m-|mx-|my-|mt-|mb-|ml-|mr-|gap-|space-)/.test(blob)) return 'spacing';
  if (/(?:text-\[\d|font-|text-(?:xs|sm|base|lg|xl|2xl|3xl)|leading-|tracking-)/.test(blob)) return 'size';
  return null;
}

/** True when edit property matches inferred complaint type (or complaint is ambiguous). */
export function editMatchesComplaint(edit, message) {
  const complaint = inferComplaintProperty(message);
  if (!complaint) return true;
  const editProp = inferEditProperty(edit);
  if (!editProp) return true;
  if (complaint === editProp) return true;
  if (complaint === 'size' && editProp === 'spacing') return false;
  if (complaint === 'spacing' && editProp === 'size') return false;
  return false;
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

  const prefix = String(find).match(/^([a-z]+(?:-[a-z]+)?)-\[/)?.[1] || '';
  const { wantLight, wantDark, wantBig, wantSmall } = directionFlags(message);

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
    if (hit) {
      const val = String(hit.value).trim();
      if (!passesColorDirection(val, find, found, message)) return null;
      if (!passesSizeDirection(val, find, found, message)) return null;
      return val;
    }
  }

  if (filtered.length === 1) {
    const val = String(filtered[0].value).trim();
    if (!passesColorDirection(val, find, found, message)) return null;
    if (!passesSizeDirection(val, find, found, message)) return null;
    return val;
  }

  if ((type === 'color' || prefix.startsWith('text') || prefix.startsWith('bg')) && filtered.length > 1) {
    const picked = pickColorByDirection(filtered, find, found, message);
    if (picked) return picked;
    if (wantLight || wantDark) return null;
  }

  const sizePool = filtered.filter((t) => t.type === 'spacing' || t.type === 'typography' || numericSize(t.value) != null);
  if ((type === 'spacing' || type === 'typography' || /^p-|^m-|^gap-|^text-/.test(prefix)) && sizePool.length > 1) {
    const picked = pickSizeByDirection(sizePool, find, found, message);
    if (picked) return picked;
    if (wantBig || wantSmall) return null;
  }

  if (filtered[0]) {
    const val = String(filtered[0].value).trim();
    if (!passesColorDirection(val, find, found, message)) return null;
    if (!passesSizeDirection(val, find, found, message)) return null;
    return val;
  }
  return null;
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
