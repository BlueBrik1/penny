// Injected into proxied dev-app HTML — spotlight, drift map, and element picker via postMessage.
(function () {
  const SPOT_LAYER = 'penny-spotlight-layer';
  const SPOT_DIM = 'penny-dim-layer';
  const MAP_LAYER = 'penny-drift-map';
  const PICKER_STYLE = 'penny-picker-style';
  const PICKER_HOVER = 'penny-picker-hover';
  const PICKER_SELECTED = 'penny-picker-selected';

  function classNameOf(el) {
    if (!el) return '';
    if (typeof el.className === 'string') return el.className;
    if (el.className?.baseVal) return el.className.baseVal;
    return el.getAttribute?.('class') || '';
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

  function findEls(marker) {
    if (!marker) return [];
    if (marker.kind === 'classContains') {
      const needle = marker.value;
      if (!needle) return [];
      const out = [];
      document.querySelectorAll('*').forEach((el) => {
        if (classNameOf(el).includes(needle)) out.push(el);
      });
      return out;
    }
    if (marker.kind === 'styleContains') {
      const needle = String(marker.value).replace(/['"]/g, '').toLowerCase();
      const alt = needle.startsWith('#') ? needle.slice(1) : null;
      const out = [];
      document.querySelectorAll('*').forEach((el) => {
        if (elementStyleMatches(el, needle, alt)) out.push(el);
      });
      return out;
    }
    try { return [...document.querySelectorAll(marker.value)]; } catch { return []; }
  }

  function clearSpotlight() {
    document.getElementById(SPOT_LAYER)?.remove();
    document.getElementById(SPOT_DIM)?.remove();
  }

  function clearMap() {
    document.getElementById(MAP_LAYER)?.remove();
  }

  const EL_SPOT_LAYER = 'penny-element-spotlight';
  const EL_SPOT_DIM = 'penny-element-spotlight-dim';

  function clearElementHighlight() {
    document.getElementById(EL_SPOT_LAYER)?.remove();
    document.getElementById(EL_SPOT_DIM)?.remove();
  }

  function findElementByDescriptor(element) {
    if (!element) return null;
    if (element.id) {
      const byId = document.getElementById(element.id);
      if (byId) return byId;
    }
    const tag = (element.tag || '*').toLowerCase();
    let pool = tag === '*'
      ? [...document.querySelectorAll('*')]
      : [...document.querySelectorAll(tag)];
    const highlight = element.highlight;
    if (highlight) {
      const byHighlight = pool.filter((el) => classNameOf(el).includes(highlight));
      if (byHighlight.length === 1) return byHighlight[0];
      if (byHighlight.length > 1) pool = byHighlight;
    }
    const classes = (element.classes || []).filter((c) => c.length > 2);
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
    if (element.text && element.text.length > 3) {
      const snippet = element.text.slice(0, 48).trim();
      const byText = pool.filter((el) =>
        (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().includes(snippet));
      if (byText.length >= 1) pool = byText;
    }
    if (element.selector && !/\[/.test(element.selector)) {
      try {
        const el = document.querySelector(element.selector);
        if (el) return el;
      } catch { /* ignore */ }
    }
    return pool[0] || null;
  }

  function paintElementBox(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const dim = document.createElement('div');
    dim.id = EL_SPOT_DIM;
    dim.setAttribute('aria-hidden', 'true');
    dim.style.cssText = 'position:fixed;inset:0;background:rgba(17,17,19,0.68);z-index:2147483645;pointer-events:none';
    document.body.appendChild(dim);
    const layer = document.createElement('div');
    layer.id = EL_SPOT_LAYER;
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:visible';
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;
      border:3px solid #fff;border-radius:6px;box-sizing:border-box;pointer-events:none;
      box-shadow:0 0 0 1px rgba(0,0,0,0.15),0 0 0 6px rgba(255,255,255,0.92),0 0 28px 10px rgba(255,255,255,0.55),0 14px 40px rgba(0,0,0,0.35)`;
    layer.appendChild(box);
    document.body.appendChild(layer);
    return true;
  }

  let lastElementDesc = null;

  function applyElementHighlight(element) {
    clearElementHighlight();
    if (!element) return false;
    const el = findElementByDescriptor(element);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return paintElementBox(el);
  }

  function clearAll() {
    clearSpotlight();
    clearMap();
    clearElementHighlight();
    lastElementDesc = null;
  }

  function applySpotlight(markers) {
    clearSpotlight();
    if (!markers?.length) return;
    const dim = document.createElement('div');
    dim.id = SPOT_DIM;
    dim.setAttribute('aria-hidden', 'true');
    dim.style.cssText = 'position:fixed;inset:0;background:rgba(17,17,19,0.68);z-index:2147483645;pointer-events:none';
    document.body.appendChild(dim);

    const layer = document.createElement('div');
    layer.id = SPOT_LAYER;
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:visible';
    const seen = new WeakSet();

    for (const m of markers) {
      for (const el of findEls(m)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const box = document.createElement('div');
        box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;
          border:3px solid #fff;border-radius:6px;box-sizing:border-box;pointer-events:none;
          box-shadow:0 0 0 1px rgba(0,0,0,0.15),0 0 0 6px rgba(255,255,255,0.92),0 0 28px 10px rgba(255,255,255,0.55),0 14px 40px rgba(0,0,0,0.35)`;
        layer.appendChild(box);
      }
    }
    if (layer.childNodes.length) document.body.appendChild(layer);
  }

  function applyMap(markers) {
    clearMap();
    if (!markers?.length) return;
    const layer = document.createElement('div');
    layer.id = MAP_LAYER;
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:visible';
    const seen = new WeakSet();

    for (const m of markers) {
      for (const el of findEls(m)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const color = m.color || '#888';
        const box = document.createElement('div');
        box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:2px dashed ${color};border-radius:4px;box-sizing:border-box;pointer-events:none;`;
        layer.appendChild(box);
        const badge = document.createElement('div');
        badge.textContent = m.label || '●';
        badge.style.cssText = `position:fixed;left:${r.right - 4}px;top:${r.top - 10}px;min-width:16px;height:16px;padding:0 3px;background:${color};color:#fff;font:bold 10px/16px system-ui,sans-serif;border-radius:999px;text-align:center;pointer-events:none;`;
        layer.appendChild(badge);
      }
    }
    if (layer.childNodes.length) document.body.appendChild(layer);
  }

  let lastMode = 'spotlight';
  let lastMarkers = [];

  function apply(mode, markers) {
    if (pickerOn) return;
    lastMode = mode;
    lastMarkers = markers || [];
    lastElementDesc = null;
    clearAll();
    if (!lastMarkers.length) return;
    if (mode === 'map') applyMap(lastMarkers);
    else applySpotlight(lastMarkers);
  }

  function rerender() {
    if (pickerOn) return;
    if (lastElementDesc) {
      applyElementHighlight(lastElementDesc);
      return;
    }
    if (!lastMarkers.length) return;
    if (lastMode === 'map') applyMap(lastMarkers);
    else applySpotlight(lastMarkers);
  }

  let pickerOn = false;
  let hoverEl = null;
  let selectedEl = null;
  let pickerMove = null;
  let pickerClick = null;

  function ensurePickerStyles() {
    if (document.getElementById(PICKER_STYLE)) return;
    const st = document.createElement('style');
    st.id = PICKER_STYLE;
    st.textContent = `
      .${PICKER_HOVER} { outline: 2px solid #4c9be8 !important; outline-offset: 2px !important; cursor: crosshair !important; }
      .${PICKER_SELECTED} { outline: 3px solid #82d69a !important; outline-offset: 2px !important; box-shadow: 0 0 0 4px rgba(130,214,154,0.35) !important; }
    `;
    document.head.appendChild(st);
  }

  function sanitizeClasses(classes) {
    return (classes || []).filter((c) => c && !/^penny-picker/.test(c));
  }

  function resolvePickTarget(el) {
    if (!el || el.nodeType !== 1) return el;
    const INTERACTIVE = new Set(['button', 'a', 'input', 'select', 'textarea', 'label', 'nav', 'header', 'footer', 'main', 'section', 'form']);
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

  function computedStyleSummary(el) {
    try {
      const cs = window.getComputedStyle(el);
      return {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        padding: cs.padding,
        borderRadius: cs.borderRadius,
      };
    } catch { return null; }
  }

  function describeElement(el) {
    const target = resolvePickTarget(el);
    if (!target || target.nodeType !== 1) return null;
    const tag = target.tagName.toLowerCase();
    const classes = sanitizeClasses(classNameOf(target).split(/\s+/).filter(Boolean).slice(0, 16));
    let selector = tag;
    if (target.id && !/^penny-picker/.test(target.id)) selector = `#${target.id}`;
    else if (classes.length) selector = `${tag}.${classes.slice(0, 3).join('.')}`;
    const text = (target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const ariaLabel = target.getAttribute('aria-label') || null;
    const elementName = text ? `${tag} “${text.slice(0, 40)}”` : (ariaLabel ? `${tag} (${ariaLabel.slice(0, 40)})` : tag);
    return {
      tag,
      id: target.id && !/^penny-picker/.test(target.id) ? target.id : null,
      classes,
      text,
      selector,
      ariaLabel,
      role: target.getAttribute('role') || null,
      href: target.getAttribute('href') || null,
      elementName,
      computedStyle: computedStyleSummary(target),
    };
  }

  function setHover(el) {
    if (hoverEl && hoverEl !== el) hoverEl.classList.remove(PICKER_HOVER);
    hoverEl = el;
    if (hoverEl && hoverEl !== selectedEl) hoverEl.classList.add(PICKER_HOVER);
  }

  function setSelected(el) {
    if (selectedEl) selectedEl.classList.remove(PICKER_SELECTED);
    selectedEl = el;
    if (selectedEl) {
      selectedEl.classList.add(PICKER_SELECTED);
      if (hoverEl === selectedEl) hoverEl.classList.remove(PICKER_HOVER);
    }
  }

  function targetFromEvent(e) {
    let el = e.target;
    while (el && el !== document.documentElement) {
      if (el.nodeType === 1 && el.id !== PICKER_STYLE) return el;
      el = el.parentElement;
    }
    return null;
  }

  function enablePicker(selectedSelector) {
    pickerOn = true;
    clearAll();
    ensurePickerStyles();
    document.documentElement.style.cursor = 'crosshair';
    if (selectedSelector) {
      try {
        const el = document.querySelector(selectedSelector);
        if (el) setSelected(el);
      } catch { /* ignore */ }
    }
    pickerMove = (e) => {
      const el = resolvePickTarget(targetFromEvent(e));
      if (el && el !== selectedEl) setHover(el);
    };
    pickerClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = resolvePickTarget(targetFromEvent(e));
      if (!el) return;
      const info = describeElement(el);
      setSelected(el);
      setHover(null);
      if (info && window.parent !== window) {
        window.parent.postMessage({ type: 'penny-element-picked', element: info }, '*');
      }
    };
    document.addEventListener('mousemove', pickerMove, true);
    document.addEventListener('click', pickerClick, true);
  }

  function disablePicker() {
    pickerOn = false;
    document.documentElement.style.cursor = '';
    if (pickerMove) document.removeEventListener('mousemove', pickerMove, true);
    if (pickerClick) document.removeEventListener('click', pickerClick, true);
    pickerMove = null;
    pickerClick = null;
    if (hoverEl) hoverEl.classList.remove(PICKER_HOVER);
    if (selectedEl) selectedEl.classList.remove(PICKER_SELECTED);
    hoverEl = null;
    selectedEl = null;
    document.getElementById(PICKER_STYLE)?.remove();
  }

  window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'penny-picker') {
      if (e.data.enabled) enablePicker(e.data.selectedSelector || null);
      else disablePicker();
      return;
    }
    if (e.data.type === 'penny-highlight-element') {
      lastMarkers = [];
      lastElementDesc = e.data.element || null;
      clearSpotlight();
      clearMap();
      clearElementHighlight();
      if (!lastElementDesc) return;
      applyElementHighlight(lastElementDesc);
      return;
    }
    if (e.data.type !== 'penny-spotlight') return;
    const mode = e.data.map ? 'map' : 'spotlight';
    apply(mode, e.data.markers || []);
    if (e.data.scroll && lastMarkers[0]) {
      findEls(lastMarkers[0])[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  window.addEventListener('scroll', rerender, true);
  window.addEventListener('resize', rerender);

  if (window.parent !== window) {
    window.parent.postMessage({ type: 'penny-bridge-ready' }, '*');
  }
})();
