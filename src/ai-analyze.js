// Full-context LLM analysis — sends source files + token inventory, returns drifts
// with problem/solution, element names, and line edits.

import { parseSource } from './parse.js';
import { diff, isRealDrift } from './diff.js';
import { enrichOffline, enrichDrifts } from './claude.js';
import { finalizeDrift, hasRequiredDriftFields } from './drift-format.js';
import { formatDismissedForPrompt } from './dismiss.js';
import { chatCompletion, resolveLlmConfig, DEFAULT_DEPLOYMENT } from './llm.js';
import { sanitizeCreativeEdit } from './concrete-fix.js';
import { buildDeterministicEdits } from './fixer.js';

export const MODEL = DEFAULT_DEPLOYMENT;

const SYSTEM = `You are Penny, a design-system drift reviewer. Analyze CSS/JSX/HTML for token drift.

Every drift MUST include ALL of these (no empty strings):
- type: "color" | "spacing" | "typography"
- category: "value-drift" | "inconsistent-usage" | "off-palette" | "off-scale"
- expected: canonical value (hex, px, font size) OR null when off-palette/off-scale
- found: array of actual wrong value(s) in code — REQUIRED, at least one
- problem: 1-2 sentences describing what's wrong (REQUIRED)
- solution: 1-2 sentences describing how to fix (REQUIRED)
- elementName: human label for the UI element to highlight (e.g. "Primary CTA button")
- highlight: CSS selector OR exact Tailwind class substring to locate the element in preview
- locations: [{ file, line, selector, prop, value, raw, elementName, highlight }] — line must match source
- edits: [{ line, before, after, find, replace }] — concrete in-file code change (REQUIRED when fixable)
- NEVER use placeholders in edits (no TOKEN_NAME, YOUR_TOKEN, [CANONICAL_VALUE]). Copy exact literals from TOKEN INVENTORY token.value.

Do NOT include severity reasoning or "why high/medium/low" prose.
Do NOT flag literals that exactly match expected.
For color/spacing/typography drifts always set both expected and found.
For off-palette/off-scale set expected null and explain in problem.
If the user payload lists dismissed elements, never report those elements again (same or similar issue).

Reply with ONLY JSON:
{"drifts":[{...}]}`;

function parseJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in model response');
  return JSON.parse(body.slice(start, end + 1));
}

function buildUserPayload({ pageId, srcFile, src, html, tokens, tokenMode, figmaSummary, dismissedItems = [] }) {
  const tokenList = (tokens || []).slice(0, 80).map((t) => ({
    name: t.name, type: t.type, value: t.value, label: t.label || t.value, count: t.count,
  }));
  const parts = [
    `Analyze pageId: ${pageId}`,
    `Source file: ${srcFile}`,
    `Token mode: ${tokenMode}`,
    figmaSummary ? `Figma baseline: ${figmaSummary}` : '',
    '\n--- TOKEN INVENTORY ---',
    JSON.stringify(tokenList, null, 2),
    `\n--- SOURCE: ${srcFile} ---`,
    src,
  ];
  if (html) {
    parts.push(`\n--- PREVIEW HTML: ${pageId}.html ---`, html.slice(0, 12000));
  }
  if (dismissedItems.length) {
    parts.push(formatDismissedForPrompt(dismissedItems));
  }
  parts.push('\nReturn all drifts for this page as JSON.');
  return parts.filter(Boolean).join('\n');
}

function validateLocation(loc, usages, srcFile) {
  const line = Number(loc.line);
  if (!line || line < 1) return null;
  const file = loc.file || srcFile;
  const lineUsages = usages.filter((u) => u.line === line && u.file === file);
  if (!lineUsages.length) return null;

  let best = lineUsages[0];
  if (loc.prop) {
    const byProp = lineUsages.find((u) => u.prop === loc.prop);
    if (byProp) best = byProp;
  }
  if (loc.value || loc.raw) {
    const v = loc.raw || loc.value;
    const byVal = lineUsages.find((u) => (u.raw ?? u.value) === v || u.value === v);
    if (byVal) best = byVal;
  }

  const highlight = loc.highlight || loc.selector || best.selector || loc.raw || null;
  return {
    file: best.file,
    line: best.line,
    selector: loc.selector || best.selector,
    prop: loc.prop || best.prop,
    value: best.value,
    raw: best.raw ?? best.value,
    syntax: best.syntax || { kind: 'css' },
    elementName: loc.elementName || loc.selector || best.selector,
    highlight,
  };
}

function normalizeDrift(d, srcFile, usages, lines, panelTokens = []) {
  const locations = (d.locations || [])
    .map((l) => validateLocation(l, usages, srcFile))
    .filter(Boolean);
  if (!locations.length) return null;

  const found = d.found?.length ? [...new Set(d.found)]
    : d.actualValues?.length ? [...new Set(d.actualValues)]
      : [...new Set(locations.map((l) => l.value))];

  const editCtx = {
    expected: d.expected ?? d.token?.value ?? null,
    token: d.token || null,
    panelTokens,
    found,
    type: d.type || 'color',
    lines,
  };

  const aiEdits = (d.edits || []).map((e) => {
    const line = Number(e.line);
    if (line < 1 || line > lines.length) return null;
    return sanitizeCreativeEdit({
      line,
      before: e.before,
      after: e.after,
      find: e.find,
      replace: e.replace,
      file: srcFile,
    }, editCtx);
  }).filter(Boolean).map((e) => ({
    line: e.line,
    before: e.before,
    after: e.after,
    find: e.find,
    replace: e.replace,
    file: srcFile,
  }));

  const drift = finalizeDrift({
    category: d.category || 'value-drift',
    type: d.type || 'color',
    severity: d.severity || 'medium',
    problem: d.problem || d.why || '',
    solution: d.solution || d.fix || '',
    token: d.token || null,
    expected: d.expected ?? d.token?.value ?? null,
    actualValues: found,
    found,
    elementName: d.elementName || locations[0]?.elementName,
    locations,
    distance: d.distance ?? 0,
    aiEdits,
  });

  return isRealDrift(drift) && hasRequiredDriftFields(drift) ? drift : null;
}

function mergeWithDiff(aiDrifts, diffDrifts, srcFile) {
  const merged = [...aiDrifts];
  const keys = new Set(aiDrifts.map((d) => driftSig(d)));

  for (const d of diffDrifts) {
    const sig = driftSig(d);
    if (keys.has(sig)) continue;
    keys.add(sig);
    merged.push(finalizeDrift({
      ...d,
      locations: d.locations.map((l) => ({
        ...l,
        elementName: l.selector,
        highlight: l.selector || l.raw,
      })),
    }));
  }

  merged.sort((a, b) => {
    const rank = { high: 3, medium: 2, low: 1 };
    const s = (rank[b.severity] || 0) - (rank[a.severity] || 0);
    if (s) return s;
    return b.locations.length - a.locations.length;
  });
  return merged.map((d, i) => ({ id: i + 1, ...finalizeDrift(d) }));
}

/** Normalize a single AI drift payload against live source (creative chat, etc.). */
export function normalizeDriftFromAi(d, srcFile, src, panelTokens = []) {
  const usages = parseSource(src, srcFile);
  const lines = src.split('\n');
  return normalizeDrift(d, srcFile, usages, lines, panelTokens);
}

export { parseJsonObject };

function driftSig(d) {
  return [d.category, d.type, d.token?.name || '', [...(d.actualValues || [])].sort().join('|')].join('::');
}

async function callModel({ client, cfg, apiKey, userContent }) {
  if (client?.complete) {
    return client.complete({ system: SYSTEM, user: userContent, maxTokens: 8192 });
  }
  const llmCfg = resolveLlmConfig(cfg || { azureOpenAiKey: apiKey });
  return chatCompletion({
    ...llmCfg,
    apiKey: apiKey || llmCfg.apiKey,
    system: SYSTEM,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 8192,
  });
}

// Rank + id + decorate rule drifts, and attach deterministic in-file edits so the UI/CLI
// can apply fixes with no LLM involvement.
function prepareRuleDrifts(rawDiff, src) {
  const decorated = rawDiff.map((d) => finalizeDrift({
    ...d,
    locations: d.locations.map((l) => ({ ...l, elementName: l.selector, highlight: l.selector || l.raw })),
  }));
  decorated.sort((a, b) => {
    const rank = { high: 3, medium: 2, low: 1 };
    const s = (rank[b.severity] || 0) - (rank[a.severity] || 0);
    return s || b.locations.length - a.locations.length;
  });
  return decorated.map((d, i) => {
    const withId = { id: i + 1, ...d };
    const edits = buildDeterministicEdits(withId, src);
    return edits.length ? { ...withId, aiEdits: edits, editsSource: 'rules' } : withId;
  });
}

export async function analyzePageWithAI({
  pageId,
  srcFile,
  src,
  html = '',
  diffTokens,
  panelTokens,
  tokenMode = 'intrinsic',
  figmaSummary = null,
  apiKey,
  cfg,
  client,
  dismissedItems = [],
  analysisMode = cfg?.analysisMode || 'rules',
  enrichWithAi = cfg?.enrichWithAi,
}) {
  const usages = parseSource(src, srcFile);
  const lines = src.split('\n');
  const rawDiff = diff(diffTokens, usages);
  const hasKey = !!(apiKey || client?.complete || resolveLlmConfig(cfg).apiKey);

  // Default (rules-first): diff() is the sole drift source. The LLM, when a key is present,
  // only enriches problem/solution copy over a small payload — never re-discovers drifts.
  if (analysisMode !== 'llm-full') {
    const prepared = prepareRuleDrifts(rawDiff, src);
    const offline = !hasKey || enrichWithAi === false;
    const enriched = await enrichDrifts(prepared, { apiKey, cfg, client, offline });
    return enriched.map((d) => finalizeDrift(d));
  }

  // Opt-in full-file LLM scan for power users (analysisMode: 'llm-full').
  if (!hasKey) return prepareRuleDrifts(rawDiff, src);

  const userContent = buildUserPayload({
    pageId, srcFile, src, html, tokens: panelTokens, tokenMode, figmaSummary, dismissedItems,
  });

  try {
    const text = await callModel({ client, cfg, apiKey, userContent });
    const parsed = parseJsonObject(text);
    const aiDrifts = (parsed.drifts || [])
      .map((d) => normalizeDrift(d, srcFile, usages, lines, panelTokens))
      .filter(Boolean);
    return mergeWithDiff(aiDrifts, rawDiff, srcFile);
  } catch {
    return prepareRuleDrifts(rawDiff, src);
  }
}

export { enrichOffline };
