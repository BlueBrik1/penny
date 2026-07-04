// Demo mode — bundled seed pages + frozen snapshot when no API key.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_PATH = path.join(ROOT, 'seed', 'demo-snapshot.json');

export function resolveApiKey(cfg) {
  return cfg?.azureOpenAiKey || process.env.AZURE_OPENAI_API_KEY || '';
}

/** True when no resolvable API key — uses demo snapshot + seed lockdown. */
export function isDemoMode(cfg) {
  return !resolveApiKey(cfg);
}

export function demoSourceDefs() {
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed/pages.json'), 'utf8'));
  return seed.map((p) => ({ id: p.id, name: p.name, src: p.css, html: p.html, seed: true }));
}

export function loadDemoSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) return null;
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
}

export function snapshotPath() {
  return SNAPSHOT_PATH;
}

/** Drifts for a page id from the frozen snapshot. */
export function demoDriftsForPage(pageId, snapshot = loadDemoSnapshot()) {
  if (!snapshot?.pages) return [];
  const page = snapshot.pages.find((p) => p.id === pageId);
  return page?.drifts || [];
}

export function demoTokens(snapshot = loadDemoSnapshot()) {
  return snapshot?.tokens || [];
}

export function demoTokenMode(snapshot = loadDemoSnapshot()) {
  return snapshot?.tokenMode || 'intrinsic';
}
