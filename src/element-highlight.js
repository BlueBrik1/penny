// Find and spotlight a picked preview element (non-tech mode → technical mode handoff).

const PICKER_NOISE = /^penny-picker(?:-|$)/;

function classNameOf(el) {
  if (!el) return '';
  if (typeof el.className === 'string') return el.className;
  if (el.className?.baseVal) return el.className.baseVal;
  return el.getAttribute?.('class') || '';
}

export function sanitizePickedClasses(classes) {
  return (classes || []).filter((c) => c && !PICKER_NOISE.test(c));
}

/** Walk up to the interactive / container element the user meant (button, link, nav, …). */
export function resolvePickTarget(el) {
  if (!el || el.nodeType !== 1) return el;
  const INTERACTIVE = new Set(['button', 'a', 'input', 'select', 'textarea', 'label', 'nav', 'header', 'footer', 'main', 'section', 'form', 'article', 'aside']);
  const ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'navigation']);
  let cur = el;
  let best = el;
  while (cur && cur.nodeType === 1 && cur.tagName?.toLowerCase() !== 'body') {
    const tag = cur.tagName.toLowerCase();
    const role = cur.getAttribute?.('role') || '';
    if (INTERACTIVE.has(tag) || ROLES.has(role)) best = cur;
    if (tag === 'a') best = cur;
    cur = cur.parentElement;
  }
  return best;
}

export function computedStyleSummary(el) {
  try {
    const view = el?.ownerDocument?.defaultView;
    if (!view) return null;
    const cs = view.getComputedStyle(el);
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      padding: cs.padding,
      borderRadius: cs.borderRadius,
    };
  } catch {
    return null;
  }
}

function humanElementName(tag, text, ariaLabel) {
  if (text?.length > 1) return `${tag} “${text.slice(0, 40)}”`;
  if (ariaLabel) return `${tag} (${ariaLabel.slice(0, 40)})`;
  return tag;
}

/** Build a clean descriptor from a live DOM node (picker). */
export function describePickedElement(rawEl) {
  const el = resolvePickTarget(rawEl);
  if (!el || el.nodeType !== 1) return null;
  const tag = el.tagName.toLowerCase();
  const classes = sanitizePickedClasses(classNameOf(el).split(/\s+/).filter(Boolean).slice(0, 16));
  const id = el.id && !PICKER_NOISE.test(el.id) ? el.id : null;
  let selector = tag;
  if (id) selector = `#${id}`;
  else if (classes.length) selector = `${tag}.${classes.slice(0, 3).join('.')}`;
  const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const ariaLabel = el.getAttribute('aria-label') || null;
  const role = el.getAttribute('role') || null;
  const href = el.getAttribute('href') || null;
  return normalizePickedElement({
    tag,
    id,
    classes,
    text,
    selector,
    ariaLabel,
    role,
    href,
    computedStyle: computedStyleSummary(el),
    elementName: humanElementName(tag, text, ariaLabel),
  });
}

/** Strip preview-only classes and recompute highlight from real classes. */
export function normalizePickedElement(el) {
  if (!el) return null;
  const classes = sanitizePickedClasses(el.classes || []);
  const highlight = classes.find((c) => /\[#/.test(c) || (/\[/.test(c) && /^(bg-|text-|border-)/.test(c)))
    || classes.find((c) => /^(bg-|text-|border-)/.test(c))
    || classes.find((c) => /^(rounded|font-|p-|m-|gap-)/.test(c))
    || el.highlight
    || classes[0]
    || el.selector;
  const elementName = el.elementName || humanElementName(el.tag || 'element', el.text, el.ariaLabel);
  const out = { ...el, classes, elementName, highlight };
  delete out.computedStyle; // keep at top level if present
  if (el.computedStyle) out.computedStyle = el.computedStyle;
  return out;
}

export function findLineInSource(src, needle) {
  if (!needle || String(needle).length < 2) return null;
  const s = String(needle);
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(s)) return i + 1;
  }
  return null;
}

export function findLineForElement(src, element) {
  if (!element || !src) return null;
  if (element.sourceLine) return Number(element.sourceLine) || null;
  if (element.id) {
    const byId = findLineInSource(src, element.id);
    if (byId) return byId;
  }
  if (element.href) {
    for (const needle of [element.href, `to="${element.href}"`, `to='${element.href}'`, `href="${element.href}"`]) {
      const line = findLineInSource(src, needle);
      if (line) return line;
    }
  }
  for (const cls of sanitizePickedClasses(element.classes || []).sort((a, b) => b.length - a.length)) {
    if (cls.length < 3) continue;
    const line = findLineInSource(src, cls);
    if (line) return line;
  }
  if (element.selector?.startsWith('.')) {
    const line = findLineInSource(src, element.selector.slice(1));
    if (line) return line;
  }
  if (element.text?.length > 2) {
    for (const word of element.text.split(/\s+/).filter((w) => w.length > 3).slice(0, 4)) {
      const line = findLineInSource(src, word);
      if (line) return line;
    }
  }
  return null;
}

/** Attach source line + nearby context for AI and scanner prompts. */
export function attachSourceContext(element, src) {
  if (!element || !src) return element;
  const clean = normalizePickedElement(element);
  const line = findLineForElement(src, clean);
  if (!line) return clean;
  const lines = src.split('\n');
  const start = Math.max(0, line - 3);
  const end = Math.min(lines.length, line + 2);
  return {
    ...clean,
    sourceLine: line,
    sourceSnippet: lines[line - 1]?.trim() || '',
    sourceContext: lines.slice(start, end).map((l, i) => `${start + i + 1}| ${l}`).join('\n'),
  };
}

export function isPreviewOnlyText(text) {
  return PICKER_NOISE.test(String(text || ''));
}

/** Reject AI edits that leak preview UI or destroy JSX structure. */
export function isInvalidCreativeEdit(before, after) {
  const b = String(before || '');
  const a = String(after || '');
  if (PICKER_NOISE.test(b) || PICKER_NOISE.test(a)) return true;
  if (/penny-picker/.test(a)) return true;
  if (/<Link\b/i.test(b) && !/<Link\b/i.test(a)) return true;
  if (/<[A-Z][A-Za-z0-9]*/.test(b) && !/<[A-Z][A-Za-z0-9]*/.test(a) && b.length > a.length + 8) return true;
  return false;
}

const SPOTLIGHT_ID = 'penny-element-spotlight';
const SPOTLIGHT_DIM_ID = 'penny-element-spotlight-dim';

/** Find the single DOM node that best matches a stored pick descriptor. */
export function findElementInDoc(doc, element) {
  if (!doc || !element) return null;
  const clean = normalizePickedElement(element);
  if (clean.id) {
    const byId = doc.getElementById(clean.id);
    if (byId) return byId;
  }

  const tag = (clean.tag || '*').toLowerCase();
  let pool = tag === '*'
    ? [...doc.querySelectorAll('*')]
    : [...doc.querySelectorAll(tag)];

  const highlight = clean.highlight;
  if (highlight) {
    const byHighlight = pool.filter((el) => classNameOf(el).includes(highlight));
    if (byHighlight.length === 1) return byHighlight[0];
    if (byHighlight.length > 1) pool = byHighlight;
  }

  const classes = sanitizePickedClasses(clean.classes || []).filter((c) => c.length > 2);
  if (classes.length >= 2) {
    const byClasses = pool.filter((el) => {
      const cn = classNameOf(el).split(/\s+/);
      return classes.every((c) => cn.includes(c));
    });
    if (byClasses.length >= 1) pool = byClasses;
  } else if (classes.length === 1) {
    const byOne = pool.filter((el) => classNameOf(el).split(/\s+/).includes(classes[0]));
    if (byOne.length >= 1) pool = byOne;
  }

  if (clean.text && clean.text.length > 3) {
    const snippet = clean.text.slice(0, 48).trim();
    const byText = pool.filter((el) =>
      (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().includes(snippet));
    if (byText.length >= 1) pool = byText;
  }

  if (clean.href) {
    const byHref = pool.filter((el) => el.getAttribute?.('href') === clean.href);
    if (byHref.length >= 1) return byHref[0];
  }

  if (pool.length === 1) return pool[0];

  if (clean.selector && !/\[/.test(clean.selector)) {
    try {
      const el = doc.querySelector(clean.selector);
      if (el) return el;
    } catch { /* invalid selector */ }
  }

  return pool[0] || null;
}

export function clearElementSpotlightInDoc(doc) {
  try {
    doc?.getElementById(SPOTLIGHT_ID)?.remove();
    doc?.getElementById(SPOTLIGHT_DIM_ID)?.remove();
  } catch { /* ignore */ }
}

function paintSpotlightBox(doc, el) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;

  const dim = doc.createElement('div');
  dim.id = SPOTLIGHT_DIM_ID;
  dim.setAttribute('aria-hidden', 'true');
  dim.style.cssText = 'position:fixed;inset:0;background:rgba(17,17,19,0.68);z-index:2147483645;pointer-events:none';
  doc.body.appendChild(dim);

  const layer = doc.createElement('div');
  layer.id = SPOTLIGHT_ID;
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:visible';

  const box = doc.createElement('div');
  box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;
    border:3px solid #fff;border-radius:6px;box-sizing:border-box;pointer-events:none;
    box-shadow:0 0 0 1px rgba(0,0,0,0.15),0 0 0 6px rgba(255,255,255,0.92),0 0 28px 10px rgba(255,255,255,0.55),0 14px 40px rgba(0,0,0,0.35)`;
  layer.appendChild(box);
  doc.body.appendChild(layer);
  return true;
}

/** Dim overlay + white box around the picked element (same-origin preview). */
export function renderElementSpotlightInDoc(doc, element) {
  clearElementSpotlightInDoc(doc);
  if (!doc?.body || !element) return false;
  const el = findElementInDoc(doc, element);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return paintSpotlightBox(doc, el);
}
