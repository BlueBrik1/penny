// Step 4: LLM reasoning layer (Azure OpenAI) — enriches diff drifts with problem/solution text.

import { chatCompletion, createLlmClient, resolveLlmConfig, DEFAULT_DEPLOYMENT } from './llm.js';
import { finalizeDrift, offlineCopy } from './drift-format.js';

const SYSTEM = `You enrich design-token drift findings. For each item return problem and solution (required, non-empty), and optionally elementName (a short human label for the UI element, e.g. "Primary CTA button").
Reply with ONLY JSON array: [{"id":N,"problem":"...","solution":"...","elementName":"..."}]`;

function toPayload(drifts) {
  return drifts.map((d) => ({
    id: d.id,
    category: d.category,
    type: d.type,
    expected: d.expected,
    found: d.actualValues,
    token: d.token ? { name: d.token.name, canonical: d.token.label || d.token.value } : null,
    locations: d.locations.slice(0, 6).map((l) => ({ file: l.file, line: l.line, selector: l.selector, prop: l.prop })),
  }));
}

function parseJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('no JSON array in model response');
  return JSON.parse(body.slice(start, end + 1));
}

async function enrichLive(drifts, { apiKey, cfg, client }) {
  const llmCfg = resolveLlmConfig(cfg || { azureOpenAiKey: apiKey });
  const user = JSON.stringify(toPayload(drifts), null, 2);
  const text = client?.complete
    ? await client.complete({ system: SYSTEM, user, maxTokens: 4096, deployment: llmCfg.deployment })
    : await chatCompletion({ ...llmCfg, apiKey: apiKey || llmCfg.apiKey, system: SYSTEM, messages: [{ role: 'user', content: user }], maxTokens: 4096 });
  return mergeResponse(drifts, text);
}

function mergeResponse(drifts, text) {
  const byId = new Map(parseJsonArray(text).map((r) => [r.id, r]));
  return drifts.map((d) => {
    const r = byId.get(d.id);
    if (!r) return finalizeDrift({ ...d, ...offlineCopy(d) });
    const elementName = r.elementName || d.elementName;
    const locations = r.elementName
      ? d.locations.map((l) => ({ ...l, elementName: r.elementName }))
      : d.locations;
    return finalizeDrift({
      ...d,
      problem: r.problem || r.why,
      solution: r.solution || r.fix,
      severity: r.severity || d.severity,
      elementName,
      locations,
    });
  });
}

function enrichOffline(drifts) {
  return drifts.map((d) => finalizeDrift({ ...d, ...offlineCopy(d) }));
}

export { enrichOffline, offlineCopy as offlineOne, DEFAULT_DEPLOYMENT as MODEL, createLlmClient };

export async function enrichDrifts(drifts, { apiKey, cfg, offline, client } = {}) {
  if (!drifts.length) return drifts;
  if (offline || (!apiKey && !client && !resolveLlmConfig(cfg).apiKey)) return enrichOffline(drifts);
  return enrichLive(drifts, { apiKey, cfg, client });
}
