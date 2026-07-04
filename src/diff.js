// Step 3: Semantic diff.
// Matches CSS usages to Figma tokens by *meaning*, not string equality. Colors are
// matched by perceptual distance (so #ff6b35 and #ff6a34 land on the same token);
// spacing/typography by a proportional tolerance around the token's value.
//
// Emits drift categories:
//   value-drift        one wrong value where a token was clearly intended
//   inconsistent-usage one token rendered as several different values across the CSS
//   off-palette / off-scale  a value with no matching token at all
// Exact literals matching a token are not flagged — hardcoding the correct value is fine.
//
// Drift shape:
//   { id, category, type, token:{name,value}|null, expected, actualValues[],
//     locations:[{file,line,selector,prop,value}], distance, severity }

import { colorDistance } from './color.js';

const SEV_RANK = { high: 3, medium: 2, low: 1 };
const COLOR_T = 30; // redmean distance within which a CSS color "means" a token
const SCALE_TOL = 0.12; // ±12% of the token value counts as the same step

function distinct(values) {
  return [...new Set(values)];
}

// Bucket usages onto their nearest token (within threshold); the rest are unmatched.
function bucketize(tokens, usages, distFn, threshold) {
  const buckets = new Map(tokens.map((t) => [t, []]));
  const unmatched = [];
  for (const u of usages) {
    let best = null;
    let bestD = Infinity;
    for (const t of tokens) {
      const d = distFn(u, t);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best && bestD <= threshold(best)) buckets.get(best).push({ u, d: bestD });
    else unmatched.push(u);
  }
  return { buckets, unmatched };
}

// Turn one token's bucket of usages into 0..2 drift flags.
function classifyBucket(token, entries, type) {
  const drifts = [];
  const uniq = distinct(entries.map((e) => e.u.value));
  const nonExact = uniq.filter((v) => v !== token.value);
  const maxD = Math.max(...entries.map((e) => e.d), 0);
  const tokenRef = { name: token.name, value: token.value, label: token.label };

  if (nonExact.length >= 2) {
    // One token splintered into several conflicting values — the clearest "wrong" signal.
    drifts.push({
      category: 'inconsistent-usage',
      type,
      token: tokenRef,
      expected: token.value,
      actualValues: uniq,
      locations: entries.map((e) => loc(e.u)),
      distance: maxD,
      severity: 'high',
    });
  } else if (nonExact.length === 1) {
    const off = entries.filter((e) => e.u.value !== token.value);
    drifts.push({
      category: 'value-drift',
      type,
      token: tokenRef,
      expected: token.value,
      actualValues: nonExact,
      locations: off.map((e) => loc(e.u)),
      distance: maxD,
      severity: maxD >= 25 ? 'high' : 'medium',
    });
  }
  return drifts;
}

function loc(u) {
  return { file: u.file, line: u.line, selector: u.selector, prop: u.prop, value: u.value, raw: u.raw ?? u.value, syntax: u.syntax || { kind: 'css' } };
}

// Values that matched no token: group by literal value into off-palette/off-scale flags.
function classifyUnmatched(unmatched, type) {
  const byValue = new Map();
  for (const u of unmatched) {
    if (!byValue.has(u.value)) byValue.set(u.value, []);
    byValue.get(u.value).push(u);
  }
  const category = type === 'color' ? 'off-palette' : 'off-scale';
  return [...byValue.entries()].map(([value, us]) => ({
    category,
    type,
    token: null,
    expected: null,
    actualValues: [value],
    locations: us.map(loc),
    distance: Infinity,
    severity: 'medium',
  }));
}

function diffColors(tokens, usages) {
  const t = tokens.filter((x) => x.type === 'color');
  const u = usages.filter((x) => x.type === 'color');
  const { buckets, unmatched } = bucketize(t, u, (uu, tt) => colorDistance(uu.color, tt.color), () => COLOR_T);
  const drifts = [];
  for (const [token, entries] of buckets) {
    if (entries.length) drifts.push(...classifyBucket(token, entries, 'color'));
  }
  drifts.push(...classifyUnmatched(unmatched, 'color'));
  return drifts;
}

function diffScale(tokens, usages, type) {
  const t = tokens.filter((x) => x.type === type);
  const u = usages.filter((x) => x.type === type);
  const { buckets, unmatched } = bucketize(
    t, u,
    (uu, tt) => Math.abs(uu.px - tt.px),
    (tt) => Math.max(1, tt.px * SCALE_TOL),
  );
  const drifts = [];
  for (const [token, entries] of buckets) {
    if (entries.length) drifts.push(...classifyBucket(token, entries, type));
  }
  drifts.push(...classifyUnmatched(unmatched, type));
  return drifts;
}

// Exact literal matches and legacy hardcoded category are not real drift.
export function isRealDrift(d) {
  if (d.category === 'hardcoded') return false;
  if (d.expected != null && d.actualValues?.length && d.actualValues.every((v) => v === d.expected)) return false;
  return true;
}

// tokens (Figma) + usages (CSS) -> ranked drift flags.
export function diff(tokens, usages) {
  const drifts = [
    ...diffColors(tokens, usages),
    ...diffScale(tokens, usages, 'spacing'),
    ...diffScale(tokens, usages, 'typography'),
  ].filter(isRealDrift);
  drifts.sort((a, b) => {
    const s = SEV_RANK[b.severity] - SEV_RANK[a.severity];
    if (s) return s;
    return b.locations.length - a.locations.length;
  });
  return drifts.map((d, i) => ({ id: i + 1, ...d }));
}
