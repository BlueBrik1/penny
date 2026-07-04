// Auto-discover CSS / JSX / Vue / Svelte pages in a project folder.

import fs from 'node:fs';
import path from 'node:path';

import { companionHtmlPath } from './preview.js';
import { loadProjectManifest, PACKAGE_ROOT } from './project-paths.js';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out',
  'vendor', '__pycache__', '.cursor', '.claude', 'favicons', 'fonts',
]);
const STYLE_EXT = new Set(['css', 'scss', 'less']);
const MARKUP_EXT = new Set(['jsx', 'tsx', 'vue', 'svelte']);
const MAX_DEPTH = 8;
const MAX_SOURCES = 24;

function slug(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'page';
}

function humanName(file) {
  return path.basename(file, path.extname(file))
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function walk(dir, depth, out, exclude) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(out.root, full).split(path.sep).join('/');
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      if (exclude.some((x) => x && rel.includes(x))) continue;
      walk(full, depth + 1, out, exclude);
      continue;
    }
    if (!ent.isFile()) continue;
    const ext = ent.name.split('.').pop()?.toLowerCase() || '';
    if (!STYLE_EXT.has(ext) && !MARKUP_EXT.has(ext)) continue;
    if (exclude.some((x) => x && rel.includes(x))) continue;
    out.files.push({ full, rel, ext, name: ent.name });
  }
}

function pairHtml(files, root) {
  const htmlByBase = new Map();
  for (const f of files) {
    if (f.ext === 'html' || f.ext === 'htm') {
      htmlByBase.set(f.rel.replace(/\.html?$/i, ''), f.rel);
    }
  }
  const sources = [];
  const usedHtml = new Set();

  for (const f of files) {
    if (f.ext === 'html' || f.ext === 'htm') continue;
    if (!STYLE_EXT.has(f.ext) && !MARKUP_EXT.has(f.ext)) continue;
    const base = f.rel.replace(/\.[^.]+$/, '');
    let htmlRel = htmlByBase.get(base) || null;
    if (!htmlRel) {
      const guess = companionHtmlPath(f.full);
      if (guess && fs.existsSync(guess)) {
        htmlRel = path.relative(root, guess).split(path.sep).join('/');
      }
    }
    if (htmlRel) usedHtml.add(htmlRel);
    sources.push({
      id: slug(f.name),
      name: humanName(f.name),
      src: f.rel,
      html: htmlRel || undefined,
    });
  }

  for (const f of files) {
    if (f.ext !== 'html' && f.ext !== 'htm') continue;
    if (usedHtml.has(f.rel)) continue;
    sources.push({ id: slug(f.name), name: humanName(f.name), src: f.rel });
  }

  return dedupeIds(sources).slice(0, MAX_SOURCES);
}

function dedupeIds(sources) {
  const seen = new Map();
  return sources.map((s) => {
    let id = s.id;
    let n = 2;
    while (seen.has(id)) { id = `${s.id}-${n++}`; }
    seen.set(id, true);
    return { ...s, id };
  });
}

/**
 * Discover scannable sources under projectDir.
 * Honors penny.json manifest when present.
 */
export function discoverSources(projectDir, opts = {}) {
  const root = path.resolve(projectDir);
  const manifest = loadProjectManifest(root);
  if (manifest?.sources?.length) {
    return {
      projectRoot: root,
      sources: manifest.sources.map((s) => ({
        id: s.id || slug(path.basename(s.src)),
        name: s.name || humanName(s.src),
        src: s.src,
        html: s.html,
      })),
      via: 'penny.json',
    };
  }

  const exclude = manifest?.exclude || opts.exclude || [];
  const out = { root, files: [] };
  walk(root, 0, out, exclude);
  const sources = pairHtml(out.files, root);
  return { projectRoot: root, sources, via: 'discover' };
}
