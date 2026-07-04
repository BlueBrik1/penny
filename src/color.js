// Shared color utilities: parse any CSS/Figma color literal to one canonical form,
// and measure perceptual distance so the diff stage can cluster near-duplicates
// (#FF6B35 vs #FF6A34) that a raw string diff would miss.

const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
  blue: '#0000ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0',
  transparent: 'rgba(0, 0, 0, 0)',
};

function clamp255(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map((n) => clamp255(n).toString(16).padStart(2, '0')).join('');
}

// str -> canonical form: '#rrggbb' when opaque, 'rgba(r, g, b, a)' when translucent,
// or null if it isn't a color literal we handle.
export function normalizeColor(str) {
  if (!str) return null;
  let s = String(str).trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];

  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length === 6) return '#' + h;
    if (h.length === 8) {
      const a = parseInt(h.slice(6, 8), 16) / 255;
      if (a >= 0.999) return '#' + h.slice(0, 6);
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
    }
    return null;
  }

  const rgb = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
    let a = 1;
    if (rgb[4] != null) a = rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    if (a >= 0.999) return toHex(r, g, b);
    return `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${Number(a.toFixed(3))})`;
  }
  return null;
}

// canonical color value -> {r,g,b,a}
export function toRgb(value) {
  if (!value) return null;
  if (value.startsWith('#')) {
    const h = value.slice(1);
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const m = value.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
  return null;
}

// Weighted RGB distance (0..~255). A cheap perceptual approximation ("redmean") — good
// enough to cluster near-identical brand colors without pulling in a Lab-conversion dep.
// ponytail: redmean heuristic; swap for CIEDE2000 only if clustering proves too coarse.
export function colorDistance(a, b) {
  const c1 = toRgb(a);
  const c2 = toRgb(b);
  if (!c1 || !c2) return Infinity;
  const rmean = (c1.r + c2.r) / 2;
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
}
