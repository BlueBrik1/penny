// Resolve drift locations to DOM elements inside a preview (React dev server or srcDoc).

export function isColorLike(value) {
  const s = String(value || '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(s) || /^rgba?\(/i.test(s);
}

function elementStyleMatches(el, needle, alt) {
  const attr = (el.getAttribute?.('style') || '').toLowerCase();
  if (attr.includes(needle) || (alt && attr.includes(alt))) return true;
  const st = el.style;
  if (!st?.length) return false;
  for (let i = 0; i < st.length; i++) {
    const val = st.getPropertyValue(st[i]).toLowerCase();
    if (val.includes(needle) || (alt && val.includes(alt))) return true;
  }
  return false;
}

function classNameOf(el) {
  if (!el) return '';
  if (typeof el.className === 'string') return el.className;
  if (el.className?.baseVal) return el.className.baseVal;
  return el.getAttribute?.('class') || '';
}

/** Find elements matching a map/spotlight marker inside a document. */
export function findPreviewElements(doc, marker) {
  if (!doc || !marker) return [];
  if (marker.kind === 'classContains') {
    const needle = marker.value;
    if (!needle) return [];
    const out = [];
    doc.querySelectorAll('*').forEach((el) => {
      if (classNameOf(el).includes(needle)) out.push(el);
    });
    return out;
  }
  if (marker.kind === 'styleContains') {
    const needle = String(marker.value).replace(/['"]/g, '').toLowerCase();
    const alt = needle.startsWith('#') ? needle.slice(1) : null;
    const out = [];
    doc.querySelectorAll('*').forEach((el) => {
      if (elementStyleMatches(el, needle, alt)) out.push(el);
    });
    return out;
  }
  try { return [...doc.querySelectorAll(marker.value)]; } catch { return []; }
}
