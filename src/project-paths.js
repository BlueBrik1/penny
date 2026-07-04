// Resolve source paths against projectRoot (user codebase) or Penny package root.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Root directory for relative src paths in config. */
export function projectRoot(cfg) {
  if (cfg?.projectRoot) return path.resolve(cfg.projectRoot);
  return PACKAGE_ROOT;
}

export function resolveSourcePath(cfg, relOrAbs) {
  if (!relOrAbs) return null;
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  return path.join(projectRoot(cfg), relOrAbs);
}

/** Load optional penny.json from a project folder. */
export function loadProjectManifest(dir) {
  for (const name of ['penny.json', '.penny.json']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* ignore */ }
    }
  }
  return null;
}
