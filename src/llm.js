// Azure OpenAI chat completions (stdlib fetch — no SDK).

export const DEFAULT_ENDPOINT = 'https://neural-ai.openai.azure.com';
export const DEFAULT_DEPLOYMENT = 'neural-companion';
export const DEFAULT_API_VERSION = '2025-01-01-preview';

export function resolveLlmConfig(cfg = {}) {
  return {
    apiKey: cfg.azureOpenAiKey || process.env.AZURE_OPENAI_API_KEY || '',
    endpoint: (cfg.azureOpenAiEndpoint || process.env.AZURE_OPENAI_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/$/, ''),
    deployment: cfg.azureOpenAiDeployment || process.env.AZURE_OPENAI_DEPLOYMENT || DEFAULT_DEPLOYMENT,
    apiVersion: cfg.azureOpenAiApiVersion || process.env.AZURE_OPENAI_API_VERSION || DEFAULT_API_VERSION,
  };
}

export function chatUrl({ endpoint, deployment, apiVersion }) {
  return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
}

/**
 * @param {{ system?: string, messages: {role:string,content:string}[], maxTokens?: number,
 *           apiKey: string, endpoint: string, deployment: string, apiVersion: string, client?: object }} opts
 */
export async function chatCompletion({ system, messages, maxTokens = 4096, apiKey, endpoint, deployment, apiVersion, client }) {
  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;

  if (client?.complete) {
    return client.complete({ system, messages: msgs, maxTokens, deployment });
  }

  const res = await fetch(chatUrl({ endpoint, deployment, apiVersion }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({ messages: msgs, max_tokens: maxTokens, temperature: 0.2 }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Azure OpenAI ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Azure OpenAI returned no content');
  return text;
}

export function createLlmClient(cfg) {
  const llmCfg = resolveLlmConfig(cfg);
  return {
    async complete({ system, user, messages, maxTokens = 4096 }) {
      const msgs = messages || [{ role: 'user', content: user }];
      return chatCompletion({ ...llmCfg, system, messages: msgs, maxTokens });
    },
  };
}
