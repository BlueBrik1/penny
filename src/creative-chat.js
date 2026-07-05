// Non-technical mode chat — plain-language coaching + optional drift/fix generation.

import { finalizeDrift, hasRequiredDriftFields } from './drift-format.js';
import { computeFixPlan, hasApplicableEdits } from './fixer.js';
import { chatCompletion, resolveLlmConfig } from './llm.js';
import { normalizeDriftFromAi, parseJsonObject } from './ai-analyze.js';
import { isRealDrift } from './diff.js';
import { isTailwindClassFragment } from './interactive.js';
import {
  attachSourceContext, findLineForElement, isInvalidCreativeEdit, normalizePickedElement,
} from './element-highlight.js';
import {
  materializeReplace, resolveConcreteValue, sanitizeCreativeEdit, editMatchesComplaint,
  inferComplaintProperty, inferEditProperty,
} from './concrete-fix.js';

const CREATIVE_SYSTEM = `You are Penny, a friendly design coach for non-technical users (marketers, PMs, founders).
Explain design and consistency issues in plain language — avoid jargon like "selector" or "token" unless the user uses them first.

When the user asks for a fix, you MUST return a drift object with working line-level edits copied exactly from the source file.

Rules for fixes:
1. Read the source file line numbers carefully (1-based).
2. Each edit MUST include the full source line as "before" and the corrected full line as "after".
3. Also include "find" (exact substring from before) and "replace" (what it becomes).
4. Use highlight with the exact Tailwind class substring from the source (e.g. "bg-[#ff7038]" or "text-white").
5. If a SELECTED ELEMENT is provided, edit ONLY sourceLine / sourceSnippet — the whole component the user clicked (button, link, nav item). Preserve all JSX structure.
6. NEVER remove or replace JSX tags (Link, Route, button wrappers). Only change className, style, or color/spacing values on the existing line.
7. NEVER include preview-only classes: penny-picker, penny-picker-hover, penny-picker-selected.
8. Match the fix to what the user said: if they mention color/dark/light, change color classes only — not font-size unless they asked for size.
9. Use computedStyle on the selected element to understand current rendered color/size; align the fix with the user's complaint.
10. NEVER use placeholders in edits: no TOKEN_NAME, YOUR_TOKEN, [CANONICAL_VALUE], or similar. Copy an exact literal from TOKEN INVENTORY (token.value — hex, px, etc.).
11. Every find/replace/before/after must be valid source code that applies cleanly. Pick the best matching token from inventory and use its exact value — do not tell the user to "add a token" without giving the concrete value in the edit.

Always respond with ONLY valid JSON (no markdown):
{
  "reply": "plain-language message to the user",
  "drift": null | {
    "category": "value-drift",
    "type": "color" | "spacing" | "typography",
    "severity": "medium",
    "problem": "...",
    "solution": "...",
    "elementName": "Primary button",
    "highlight": "bg-[#ff7038]",
    "expected": "#ff6b35",
    "found": ["#ff7038"],
    "locations": [{ "file": "<srcFile from payload>", "line": 44, "selector": ".btn", "raw": "#ff7038" }],
    "edits": [{ "line": 44, "before": "<exact full line from source>", "after": "<full line with fix>", "find": "#ff7038", "replace": "#ff6b35" }]
  }
}

When drift includes edits, tell the user they can switch off Non-tech mode to review and apply the fix in Technical mode or via CLI. Do not say the fix was already applied.`;

function formatHistory(history = []) {
  return history.slice(-6).map((m) => `${m.role === 'user' ? 'User' : 'Penny'}: ${m.content}`).join('\n');
}

function findLineInSource(src, needle) {
  if (!needle || String(needle).length < 2) return null;
  const s = String(needle);
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(s)) return i + 1;
  }
  return null;
}

function enrichEdits(edits, src, element, ctx = {}) {
  const lines = src.split('\n');
  const out = [];
  for (const raw of edits || []) {
    let line = Number(raw.line);
    let before = raw.before != null ? String(raw.before) : '';
    let after = raw.after != null ? String(raw.after) : '';
    let find = raw.find != null ? String(raw.find) : '';
    let replace = raw.replace != null ? String(raw.replace) : '';

    if (find && (!line || line < 1 || line > lines.length || !lines[line - 1]?.includes(find))) {
      const byFind = findLineInSource(src, find);
      if (byFind) line = byFind;
    }
    if ((!line || line < 1 || line > lines.length) && before) {
      const byBefore = findLineInSource(src, before.slice(0, 80));
      if (byBefore) line = byBefore;
    }
    if ((!line || line < 1 || line > lines.length) && element) {
      line = findLineForElement(src, element);
    }
    if (!line || line < 1 || line > lines.length) continue;

    if (!before) before = lines[line - 1];
    if (!after && find && replace && before.includes(find)) after = before.replace(find, replace);

    const sanitized = sanitizeCreativeEdit(
      { line, before, after, find, replace, file: raw.file },
      { ...ctx, lines, found: ctx.found },
    );
    if (!sanitized) continue;
    if (!editMatchesComplaint(sanitized, ctx.message || '')) continue;
    if (isInvalidCreativeEdit(sanitized.before, sanitized.after)) continue;
    out.push(sanitized);
  }
  return out;
}

function locationSyntax(highlight, raw) {
  const needle = highlight || raw || '';
  if (isTailwindClassFragment(needle)) {
    return { kind: 'tw-arb', prefix: needle.replace(/-\[.*/, '').split('-')[0] || 'tw' };
  }
  return { kind: 'css' };
}

function locationsFromEdits(edits, srcFile, meta, element) {
  const hl = meta.highlight || element?.highlight || element?.classes?.[0] || element?.selector || '';
  return edits.map((e) => {
    const raw = e.find || hl || '';
    return {
      file: srcFile,
      line: e.line,
      selector: hl || element?.selector || '',
      highlight: hl,
      prop: meta.prop || null,
      value: e.find || '',
      raw,
      elementName: meta.elementName || element?.elementName || 'element',
      syntax: locationSyntax(hl, raw),
    };
  });
}

/** Lenient normalizer for creative chat — accepts edits even when parseSource has no usage on that line. */
export function normalizeCreativeDrift(d, srcFile, src, element = null, options = {}) {
  if (!d) return null;
  const strict = normalizeDriftFromAi(d, srcFile, src, options.panelTokens);
  if (strict) return strict;

  const editCtx = {
    expected: d.expected ?? d.token?.value ?? null,
    token: d.token || null,
    panelTokens: options.panelTokens || [],
    found: d.found || d.actualValues || [],
    type: d.type || 'color',
    message: options.message || '',
  };

  const meta = {
    elementName: d.elementName || element?.elementName || null,
    highlight: d.highlight || d.locations?.[0]?.highlight || d.locations?.[0]?.selector
      || element?.classes?.find((c) => src.includes(c)) || element?.selector || null,
    prop: d.locations?.[0]?.prop || null,
  };

  let edits = enrichEdits(d.edits, src, element, editCtx);

  if (!edits.length && (d.expected != null || d.found?.length)) {
    const needle = d.found?.[0] || d.locations?.[0]?.raw || d.locations?.[0]?.value || meta.highlight;
    const line = Number(d.locations?.[0]?.line) || findLineInSource(src, needle) || findLineForElement(src, element);
    if (line && line >= 1) {
      const lines = src.split('\n');
      const before = lines[line - 1] || '';
      const find = d.found?.[0] || d.locations?.[0]?.raw || needle || '';
      const concrete = resolveConcreteValue({ ...editCtx, find });
      if (find && before.includes(find) && concrete) {
        const replace = materializeReplace(find, concrete) || concrete;
        edits = [{
          line,
          before,
          after: before.replace(find, replace),
          find,
          replace,
        }];
      }
    }
  }

  let locations = edits.length
    ? locationsFromEdits(edits, srcFile, meta, element)
    : (d.locations || []).map((loc) => {
      const line = Number(loc.line) || findLineInSource(src, loc.raw || loc.highlight || meta.highlight) || findLineForElement(src, element);
      if (!line) return null;
      return {
        file: srcFile,
        line,
        selector: loc.selector || meta.highlight || '',
        highlight: loc.highlight || meta.highlight || loc.selector || '',
        prop: loc.prop || null,
        value: loc.value || loc.raw || '',
        raw: loc.raw || loc.value || '',
        elementName: loc.elementName || meta.elementName || 'element',
        syntax: locationSyntax(loc.highlight || meta.highlight, loc.raw || loc.value),
      };
    }).filter(Boolean);

  if (!locations.length && meta.highlight) {
    const line = findLineInSource(src, meta.highlight) || findLineForElement(src, element);
    if (line) {
      locations = [{
        file: srcFile,
        line,
        selector: meta.highlight,
        highlight: meta.highlight,
        prop: null,
        value: d.found?.[0] || '',
        raw: d.found?.[0] || meta.highlight || '',
        elementName: meta.elementName || 'element',
        syntax: locationSyntax(meta.highlight, d.found?.[0] || meta.highlight),
      }];
    }
  }

  if (!locations.length) return null;

  const found = d.found?.length ? [...new Set(d.found)]
    : d.actualValues?.length ? [...new Set(d.actualValues)]
      : edits.map((e) => e.find).filter(Boolean);

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
    elementName: meta.elementName || locations[0]?.elementName,
    highlight: meta.highlight || locations[0]?.highlight || null,
    locations,
    aiEdits: edits.map((e) => ({
      line: e.line,
      before: e.before,
      after: e.after,
      find: e.find,
      replace: e.replace,
      file: srcFile,
    })),
  });

  if (!hasRequiredDriftFields(drift) || !isRealDrift(drift)) return null;
  return drift;
}

/** Stamp picked element metadata onto a drift for correct highlights in technical mode. */
export function applyElementToDrift(drift, element) {
  if (!drift || !element) return drift;
  const clean = normalizePickedElement(element);
  const highlight = clean.highlight || clean.classes?.[0] || clean.selector;
  const elementName = clean.elementName || clean.text?.slice(0, 40) || clean.tag || drift.elementName;
  return finalizeDrift({
    ...drift,
    highlight,
    elementName,
    pickedElement: clean,
    locations: (drift.locations || []).map((loc) => {
      const hl = highlight || loc.highlight;
      const raw = loc.raw || hl || '';
      const syntax = (loc.syntax?.kind === 'tw-arb' || loc.syntax?.kind === 'tw-space')
        ? loc.syntax
        : locationSyntax(hl, raw);
      return {
        ...loc,
        highlight: hl,
        raw: raw || loc.raw,
        selector: hl || loc.selector,
        syntax,
        elementName: elementName || loc.elementName,
      };
    }),
  });
}

function buildPayload({ page, element, message, history, panelTokens, tokenMode, figmaSummary }) {
  const tokenList = (panelTokens || []).slice(0, 40).map((t) => ({
    name: t.name, type: t.type, value: t.value, label: t.label || t.value,
  }));
  const elCtx = element ? attachSourceContext(element, page.src) : null;
  const parts = [
    `Page: ${page.name}`,
    `Source file (use this exact name in locations[].file): ${page.srcFile}`,
    `Token mode: ${tokenMode}`,
    figmaSummary ? `Figma baseline: ${figmaSummary}` : '',
    elCtx
      ? `\n--- SELECTED ELEMENT (whole component the user clicked — edit sourceLine only, keep JSX tags) ---\n${JSON.stringify(elCtx, null, 2)}\n\nUser complaint: ${message}\nFix ONLY what they asked for (color vs size vs spacing).`
      : '\n(No element selected — locate the right line from the user description.)',
    '\n--- TOKEN INVENTORY (sample) ---',
    JSON.stringify(tokenList, null, 2),
    `\n--- SOURCE: ${page.srcFile} (line numbers start at 1) ---`,
    page.src.split('\n').map((line, i) => `${String(i + 1).padStart(4, ' ')}| ${line}`).join('\n'),
  ];
  if (page.html) parts.push(`\n--- PREVIEW HTML ---\n${page.html.slice(0, 8000)}`);
  if (history?.length) parts.push('\n--- RECENT CHAT ---\n', formatHistory(history));
  parts.push(`\nUser message: ${message}`);
  return parts.filter(Boolean).join('\n');
}

// Which drift type a source fragment represents (normalized to color|spacing|typography).
function fragmentType(frag) {
  const p = inferEditProperty({ find: frag, replace: frag, before: frag, after: frag });
  return p === 'size' ? 'typography' : p;
}

// The literal/class on `line` to replace, matching the complaint type.
function pickFragment(line, clean, driftType) {
  const cands = [clean.highlight, ...(clean.classes || []), clean.selector].filter(Boolean);
  const onLine = cands.find((c) => line.includes(c) && fragmentType(c) === driftType);
  if (onLine) return onLine;
  if (driftType === 'color') return line.match(/#[0-9a-fA-F]{3,8}/)?.[0] || null;
  return line.match(/\d+px/)?.[0] || null;
}

function deterministicReply(clean, driftType, concrete) {
  const what = driftType === 'color' ? 'color' : driftType === 'spacing' ? 'spacing' : 'text size';
  const name = clean.elementName || clean.tag || 'element';
  return `I matched the ${what} on the ${name} to ${concrete} from your design tokens.`
    + '\n\nTurn off **Non-tech** to review and apply this fix in Technical mode, or use the CLI link below.';
}

/**
 * Resolve a Non-tech fix from the token inventory alone — no LLM. Returns { reply, drift }
 * when the picked element + complaint map cleanly to a design token, else null (LLM fallback).
 */
export function tryDeterministicCreativeFix({ page, element, message, panelTokens = [] }) {
  if (!element) return null;
  const type = inferComplaintProperty(message); // color | spacing | size | null
  if (!type) return null; // ambiguous complaint — let the LLM interpret it
  const driftType = type === 'size' ? 'typography' : type;

  const clean = normalizePickedElement(element);
  const line = findLineForElement(page.src, clean);
  if (!line) return null;
  const before = page.src.split('\n')[line - 1] || '';
  const find = pickFragment(before, clean, driftType);
  if (!find || !before.includes(find)) return null;

  // normalizeCreativeDrift resolves the concrete token value + builds the edit deterministically.
  // locations:[]/edits:[] routes through the lenient path, which resolves the concrete
  // token value and materializes the edit deterministically.
  const drift = normalizeCreativeDrift({
    category: 'value-drift',
    type: driftType,
    severity: 'medium',
    found: [find],
    highlight: clean.highlight,
    locations: [],
    edits: [],
  }, page.srcFile, page.src, clean, { panelTokens, message });

  if (!drift?.aiEdits?.length) return null; // no resolvable token — fall through to LLM
  const finalized = applyElementToDrift(drift, element);
  return { reply: deterministicReply(clean, driftType, finalized.expected || find), drift: finalized };
}

export async function runCreativeChat({
  page, element, message, history = [], panelTokens, tokenMode, figmaSummary, cfg, apiKey,
}) {
  // Rules-first: try to resolve the fix from the token inventory before touching the LLM.
  const deterministic = tryDeterministicCreativeFix({ page, element, message, panelTokens });
  if (deterministic) return deterministic;

  const llmCfg = resolveLlmConfig(cfg || { azureOpenAiKey: apiKey });
  const key = apiKey || llmCfg.apiKey;
  if (!key) {
    return {
      reply: element
        ? `I see you selected the ${element.tag || 'element'}${element.text ? ` (“${element.text.slice(0, 40)}”)` : ''}. Connect Azure OpenAI in onboarding for AI coaching.`
        : 'Connect Azure OpenAI in onboarding to chat with Penny.',
      drift: null,
    };
  }

  const userContent = buildPayload({
    page, element: element ? normalizePickedElement(element) : null, message, history, panelTokens, tokenMode, figmaSummary,
  });
  const text = await chatCompletion({
    ...llmCfg,
    apiKey: key,
    system: CREATIVE_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 4096,
  });

  const parsed = parseJsonObject(text);
  let reply = String(parsed.reply || '').trim() || 'I’m not sure — try describing what feels off visually.';
  let drift = parsed.drift || null;

  if (drift) {
    const normalized = normalizeCreativeDrift(drift, page.srcFile, page.src, element, {
      panelTokens, message,
    });
    if (normalized) {
      drift = element ? applyElementToDrift(normalized, element) : normalized;
      const plan = computeFixPlan(page.src, [normalized]);
      const fixable = plan.some(hasApplicableEdits);
      if (fixable && !/technical mode|non-tech|cli/i.test(reply)) {
        reply += '\n\nTurn off **Non-tech** to review and apply this fix in Technical mode, or use the CLI link below.';
      } else if (!fixable && !/technical mode|non-tech|cli/i.test(reply)) {
        reply += '\n\nI noted the issue — turn off **Non-tech** for Technical mode if you want to apply a code fix.';
      }
    } else {
      drift = null;
      if (!/couldn’t|could not|unable|couldn't/i.test(reply)) {
        reply += element
          ? '\n\nI couldn’t build a line-level fix from that — try rephrasing what should change (color, size, spacing) or click a different element.'
          : '\n\nClick the element in the preview first, then describe what feels wrong — that helps me find the exact line to fix.';
      }
    }
  }

  return { reply, drift };
}

/** Append an already-normalized creative drift to a page; returns new drift id or null. */
export function appendCreativeDrift(page, drift) {
  if (!drift?.locations?.length || !drift.problem?.trim()) return null;
  const id = page.drifts?.length ? Math.max(...page.drifts.map((d) => d.id)) + 1 : 1;
  page.drifts = [...(page.drifts || []), { id, ...finalizeDrift(drift) }];
  return id;
}
