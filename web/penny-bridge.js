// Injected into proxied dev-app HTML — spotlight + drift map overlays via postMessage.
(function () {
  const SPOT_LAYER = 'penny-spotlight-layer';
  const SPOT_DIM = 'penny-dim-layer';
  const MAP_LAYER = 'penny-drift-map';

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

  function clearAll() {
    clearSpotlight();
    clearMap();
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
    lastMode = mode;
    lastMarkers = markers || [];
    clearAll();
    if (!lastMarkers.length) return;
    if (mode === 'map') applyMap(lastMarkers);
    else applySpotlight(lastMarkers);
  }

  function rerender() {
    if (!lastMarkers.length) return;
    if (lastMode === 'map') applyMap(lastMarkers);
    else applySpotlight(lastMarkers);
  }

  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'penny-spotlight') return;
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
