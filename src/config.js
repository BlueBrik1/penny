// Local preferences persisted to ~/.driftrc (JSON). Written once during onboarding and
// reused on every run so nothing has to be re-prompted. Everything here is plain stdlib.
//
// Shape:
//   { figmaToken, figmaFileKey, figmaFrameNode, figmaUrl,
//     azureOpenAiKey, azureOpenAiEndpoint, azureOpenAiDeployment, azureOpenAiApiVersion,
//     scanMode: 'ondemand'|'watch'|'interval'|'autonomous'|'agent', intervalMinutes,
//     onboardingComplete, tutorialComplete,
//     exclude: [<path substring>], sources: [{ id, name, src, html? }],
//     dismissedItems: [{ pageId, element, elementName?, category, type, token? }] }

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { select, input } from './prompt.js';
import { installAgentHooks } from './install-hooks.js';
import { hasApiKey } from './demo-mode.js';
import { discoverSources } from './discover-sources.js';
import { createLlmClient, DEFAULT_ENDPOINT, DEFAULT_DEPLOYMENT, DEFAULT_API_VERSION } from './llm.js';
import { clearBootCache } from './boot-cache.js';

export const CONFIG_PATH = process.env.DRIFTRC || path.join(os.homedir(), '.driftrc');

const AGENTS = ['Claude Code', 'Cursor', 'Windsurf', 'GitHub Copilot', 'Other'];

const DEFAULTS = {
  figmaToken: '',
  figmaFileKey: '',
  figmaFrameNode: '',
  figmaUrl: '',
  azureOpenAiKey: '',
  azureOpenAiEndpoint: DEFAULT_ENDPOINT,
  azureOpenAiDeployment: DEFAULT_DEPLOYMENT,
  azureOpenAiApiVersion: DEFAULT_API_VERSION,
  agent: 'Claude Code',
  scanMode: 'ondemand',
  intervalMinutes: 5,
  exclude: [],
  projectRoot: '',
  sources: [], // empty -> auto-discover during onboarding or ensureProjectSources
  uiMode: 'dashboard',
  onboardingComplete: false,
  tutorialComplete: false,
  previewDevServer: '',
  dismissedItems: [],
};

export function configExists() {
  return fs.existsSync(CONFIG_PATH);
}

/** Agent hooks (Cursor / Claude Code stop) should only trigger scans in agent mode. */
export function shouldRunAgentHookScan(cfg = loadConfig()) {
  return cfg.scanMode === 'agent';
}

/** File-watch rescans — watch + autonomous only. */
export function shouldWatchScan(cfg = loadConfig()) {
  return cfg.scanMode === 'watch' || cfg.scanMode === 'autonomous';
}

/** Timer rescans — interval mode only. */
export function shouldIntervalScan(cfg = loadConfig()) {
  return cfg.scanMode === 'interval';
}

export function loadConfig() {
  try {
    const cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    if (configExists()) cfg.onboardingComplete = true;
    // Legacy field from Anthropic era
    if (!cfg.azureOpenAiKey && cfg.anthropicKey) cfg.azureOpenAiKey = cfg.anthropicKey;
    return cfg;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(cfg) {
  const out = { ...cfg };
  if (configExists() || out.sources?.length || out.azureOpenAiKey || out.projectRoot) {
    out.onboardingComplete = true;
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2));
  return out;
}

export function updateConfig(patch) {
  return saveConfig({ ...loadConfig(), ...patch });
}

/** Clear dismissals and scan memory for a fresh AI pass. */
export function resetScanState() {
  clearBootCache();
  return updateConfig({ dismissed: [], dismissedItems: [], lastScanDriftCount: null });
}

/** Fill projectRoot + sources when missing (live mode only). */
export function ensureProjectSources(cfg) {
  if (cfg.sources?.length) return cfg;
  const preset = discoverSources(process.cwd());
  if (!preset.sources.length) return cfg;
  const updated = { ...cfg, projectRoot: preset.projectRoot, sources: preset.sources };
  saveConfig(updated);
  return updated;
}

async function configureSources(cfg) {
  const choices = [
    { label: `This folder — auto-detect CSS / JSX (${process.cwd()})`, value: 'cwd' },
    { label: 'Another folder — type a path', value: 'path' },
  ];
  const pick = await select('What should Penny scan?', choices, 0);

  const preset = pick === 'path'
    ? discoverSources(await input('Project folder', process.cwd(), 'Root of the codebase to scan.'))
    : discoverSources(process.cwd());

  if (!preset.sources.length) {
    console.error('\n\x1b[31mNo CSS / JSX pages found in that folder.\x1b[0m');
    console.error('  Point Penny at your frontend root (where .jsx / .css live) and try again.\n');
    process.exit(1);
  }

  cfg.projectRoot = preset.projectRoot;
  cfg.sources = preset.sources;
  console.log(`\n  \x1b[32m✓\x1b[0m ${cfg.sources.length} page(s) (${preset.via})`);
  for (const s of cfg.sources.slice(0, 6)) console.log(`    · ${s.name} — ${s.src}`);
  if (cfg.sources.length > 6) console.log(`    … +${cfg.sources.length - 6} more`);
  console.log('');
  return cfg;
}

function parsePreviewDevServer(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s.replace(/\/$/, '');
  const hostMatch = s.match(/^(?:localhost|127\.0\.0\.1):(\d+)/i);
  if (hostMatch) return `http://localhost:${hostMatch[1]}`;
  const port = s.replace(/\D/g, '') || '3000';
  return `http://localhost:${port}`;
}

async function configurePreviewDevServer(cfg) {
  const existing = cfg.previewDevServer || '';
  const def = existing ? existing.replace(/^https?:\/\/(localhost|127\.0\.0\.1):/i, '') : '3000';
  const raw = await input(
    '(required for React/Vite) What\'s the port for your dev server? (localhost:xxxx)',
    def,
    [
      'Required for React/Vite live preview in penny view.',
      'Run npm run dev and enter the port it shows (e.g. 3000 for CRA, 5173 for Vite).',
    ].join('\n'),
  );
  cfg.previewDevServer = parsePreviewDevServer(raw || def);
  console.log(`\n  \x1b[32m✓\x1b[0m previewDevServer → ${cfg.previewDevServer}\n`);
  return cfg;
}

// First-run onboarding — Figma credentials are optional.
export async function onboard() {
  const cfg = loadConfig();
  process.stdout.write('\x1b[2J\x1b[H');

  console.log('\x1b[1mPenny\x1b[0m scans your CSS and JSX for inconsistent colors, spacing, and typography.');
  console.log('An Azure OpenAI API key is required.\n');

  const connectFigma = await select('Connect Figma as a design baseline?', [
    { label: 'No — scan the codebase only (recommended)', value: false },
    { label: 'Yes — add Figma API credentials', value: true },
  ], 0);

  if (connectFigma) {
    const tokenHelp = [
      'How to get a Figma personal access token:',
      '  1. Sign in at figma.com → avatar → Settings → Security.',
      '  2. Generate a token with read access to File content / metadata.',
      '  3. Copy the figd_… token and paste below. Leave blank to skip.',
    ].join('\n');
    cfg.figmaToken = await input('Figma personal access token (optional)', cfg.figmaToken, tokenHelp);
    if (cfg.figmaToken) {
      cfg.figmaFileKey = await input('Figma file key', cfg.figmaFileKey,
        'From the file URL: figma.com/design/FILE_KEY/…');
      cfg.figmaFrameNode = await input('Frame node id (optional, e.g. 12:34)', cfg.figmaFrameNode,
        'Right-click a frame → Copy link → use the node-id as 12:34');
      cfg.figmaUrl = await input('Figma embed URL (optional)', cfg.figmaUrl);
    }
  }

  cfg.azureOpenAiKey = await input(
    'Azure OpenAI API key',
    cfg.azureOpenAiKey || process.env.AZURE_OPENAI_API_KEY || '',
    [
      'Penny uses Azure OpenAI to analyze your CSS/JSX and produce drifts, fixes, and map labels.',
      'Get a key from your Azure OpenAI resource → Keys and Endpoint.',
    ].join('\n'),
  );

  if (!cfg.azureOpenAiKey.trim()) {
    console.error('\n\x1b[31mAPI key required.\x1b[0m Penny cannot run without an Azure OpenAI key.\n');
    process.exit(1);
  }

  cfg.azureOpenAiKey = cfg.azureOpenAiKey.trim();
  try {
    const client = createLlmClient(cfg);
    await client.complete({ system: 'Reply with ok only.', user: 'ping', maxTokens: 8 });
    console.log('\n\x1b[32m✓ API key validated\x1b[0m\n');
  } catch (e) {
    console.log(`\n\x1b[33m⚠ Key validation failed\x1b[0m (${e.message}). Saving anyway — check the key if scans fail.\n`);
  }

  const agent = await select('Which agent handles "Ask your agent"?',
    AGENTS.map((a) => ({ label: a, value: a })), Math.max(0, AGENTS.indexOf(cfg.agent)));
  if (agent != null) cfg.agent = agent;

  const modes = [
    { label: 'On demand — rescan when you ask', value: 'ondemand' },
    { label: 'When your agent finishes — rescan after each prompt (recommended, can get expensive)', value: 'agent' },
    { label: 'On file save — watch and rescan live (can get expensive)', value: 'watch' },
    { label: 'Interval — rescan on a timer', value: 'interval' },
    { label: 'Autonomous — watch and auto-apply fixes (can get expensive)', value: 'autonomous' },
  ];
  const mode = await select('Scan frequency', modes, Math.max(0, modes.findIndex((m) => m.value === cfg.scanMode)));
  if (mode != null) cfg.scanMode = mode;

  if (cfg.scanMode === 'interval') {
    const mins = await select('Rescan every', [1, 5, 10, 15, 30, 60].map((n) => ({ label: `${n} min`, value: n })), 1);
    if (mins != null) cfg.intervalMinutes = mins;
  }

  await configureSources(cfg);
  await configurePreviewDevServer(cfg);

  cfg.onboardingComplete = true;
  saveConfig(cfg);
  process.stdout.write('\n');
  console.log('\x1b[32m✓ Setup complete\x1b[0m');
  console.log(`  Config saved to ${CONFIG_PATH}`);
  const scanLabel = cfg.scanMode === 'interval' ? `${cfg.scanMode} (${cfg.intervalMinutes}m)`
    : cfg.scanMode === 'agent' ? 'agent (hooks after each prompt)' : cfg.scanMode;
  console.log(`  agent: ${cfg.agent}   scan: ${scanLabel}`);
  console.log(`  pages: ${cfg.sources.length} under ${cfg.projectRoot}`);
  console.log(`  preview: ${cfg.previewDevServer || '(not set)'}`);
  console.log(`  baseline: ${cfg.figmaToken && cfg.figmaFileKey ? 'Figma file' : 'codebase (intrinsic)'}`);
  console.log('');

  if (cfg.scanMode === 'agent') {
    const paths = installAgentHooks(cfg.projectRoot || process.cwd());
    console.log('\x1b[32m✓ Agent hooks installed\x1b[0m');
    console.log(`  ${paths.hookScript}`);
    console.log(`  ${paths.claude}`);
    console.log(`  ${paths.cursor}`);
    console.log('  Reload Cursor if open. Use Claude Code / Cursor from this project root.\n');
  }

  console.log('  \x1b[1mNext step:\x1b[0m  penny view   (restart if already open)');
  console.log('');
  return cfg;
}
