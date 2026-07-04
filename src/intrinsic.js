// Codebase-native analysis: discover every token-like usage in source and derive
// canonical values for drift detection without a Figma file.

import { colorDistance } from './color.js';
import { diff } from './diff.js';

const COLOR_T = 30;
const SCALE_STEPS = {
  spacing: [4, 8, 12, 16, 20, 24, 32, 48, 999],
  typography: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 24, 30, 31, 32],
};

function tokenName(type, value) {
  return `${type}/${value}`;
}

/** Inventory of unique values found in source — powers the tokens panel. */
export function discoveredTokens(usages) {
  const map = new Map();
  for (const u of usages) {
    const key = `${u.type}|${u.value}`;
    if (!map.has(key)) {
      map.set(key, {
        name: tokenName(u.type, u.value),
        type: u.type,
        value: u.value,
        color: u.color,
        px: u.px,
        count: 0,
        selectors: new Set(),
      });
    }
    const e = map.get(key);
    e.count += 1;
    if (u.selector) e.selectors.add(u.selector.replace(/:{1,2}[a-z-]+(\([^)]*\))?/g, '').trim());
  }
  return [...map.values()]
    .map((e) => {
      const sample = [...e.selectors].slice(0, 3).join(', ');
      return {
        name: e.name,
        type: e.type,
        value: e.value,
        color: e.color,
        px: e.px,
        label: e.value,
        count: e.count,
        nodePath: `${e.count} use${e.count === 1 ? '' : 's'}${sample ? ` · ${sample}${e.selectors.size > 3 ? '…' : ''}` : ''}`,
        discovered: true,
      };
    })
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
}

function clusterColors(usages) {
  const clusters = [];
  for (const u of usages) {
    let hit = null;
    for (const c of clusters) {
      if (colorDistance(u.color, c.rep.color) <= COLOR_T) { hit = c; break; }
    }
    if (hit) hit.items.push(u);
    else clusters.push({ rep: u, items: [u] });
  }
  return clusters;
}

function modeValue(items) {
  const counts = new Map();
  for (const u of items) counts.set(u.value, (counts.get(u.value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function deriveColorTokens(usages) {
  const clusters = clusterColors(usages);
  return clusters
    .filter((c) => c.items.length >= 2)
    .map((c) => {
      const value = modeValue(c.items);
      return { name: tokenName('color', value), type: 'color', value, color: value };
    });
}

function deriveScaleTokens(usages, type) {
  const tokens = [];
  for (const step of SCALE_STEPS[type]) {
    const tol = Math.max(1, step * 0.12);
    if (usages.some((u) => Math.abs(u.px - step) <= tol)) {
      tokens.push({ name: tokenName(type, `${step}px`), type, value: `${step}px`, px: step });
    }
  }
  return tokens;
}

/** Canonical baselines inferred from the codebase — used by diff() when Figma is absent. */
export function deriveCanonicalTokens(usages) {
  return [
    ...deriveColorTokens(usages.filter((u) => u.type === 'color')),
    ...deriveScaleTokens(usages.filter((u) => u.type === 'spacing'), 'spacing'),
    ...deriveScaleTokens(usages.filter((u) => u.type === 'typography'), 'typography'),
  ];
}

export function diffFromCode(usages) {
  return diff(deriveCanonicalTokens(usages), usages);
}

export function analyzeUsages(allUsages, { figmaTokens = null } = {}) {
  const diffTokens = figmaTokens?.length ? figmaTokens : deriveCanonicalTokens(allUsages);
  return {
    panelTokens: discoveredTokens(allUsages),
    diffTokens,
    mode: figmaTokens?.length ? 'figma' : 'intrinsic',
  };
}
