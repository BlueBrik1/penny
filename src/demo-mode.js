// API key helpers (legacy module name kept for import stability).

export function resolveApiKey(cfg) {
  return cfg?.azureOpenAiKey || process.env.AZURE_OPENAI_API_KEY || '';
}

export function hasApiKey(cfg) {
  return !!resolveApiKey(cfg);
}
