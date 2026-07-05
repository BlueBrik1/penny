// Load a committed design-token file as the canonical baseline for diffing.
//
// Format (all sections optional):
//   { "colors": { "primary": "#ff6b35" },
//     "spacing": { "md": "16px" },
//     "typography": { "body": "16px" } }
//
// Normalizes to Penny's token shape: { name, type, value, label, color?/px? }.

import fs from 'node:fs';

const SECTIONS = {
  colors: 'color',
  spacing: 'spacing',
  typography: 'typography',
};

function normalizeSection(obj, type) {
  return Object.entries(obj || {})
    .filter(([, v]) => v != null && String(v).trim())
    .map(([key, v]) => {
      const value = String(v).trim();
      const token = { name: `${type}/${key}`, type, value, label: value };
      if (type === 'color') token.color = value;
      else token.px = parseFloat(value);
      return token;
    });
}

/** Read + normalize a token file. Throws on missing/invalid — callers decide the fallback. */
export function loadTokenFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const tokens = Object.entries(SECTIONS).flatMap(([section, type]) => normalizeSection(raw[section], type));
  if (!tokens.length) throw new Error('token file has no colors/spacing/typography');
  return tokens;
}

/** Load if configured; returns null (with a warning) when missing or invalid, so scans fall back to intrinsic. */
export function resolveTokenFile(cfg = {}) {
  if (!cfg.tokensFile) return null;
  try {
    return loadTokenFile(cfg.tokensFile);
  } catch (e) {
    console.warn(`penny: tokensFile ${cfg.tokensFile} ignored (${e.message}); using intrinsic tokens.`);
    return null;
  }
}
