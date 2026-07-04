#!/usr/bin/env node
// Penny — interactive drift coach. Scans CSS / JSX by default; optional Figma baseline.

import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadConfig, configExists, onboard, ensureProjectSources } from './config.js';
import { runTui } from './tui.js';
import { loadSourcePages, runScan, formatScanLines } from './scan.js';
import { hooksHelpText, runAgentHooksTutorial } from './agent-hooks-tutorial.js';
import { analyzeAllPages } from './pipeline.js';
import { isDemoMode } from './demo-mode.js';
import { isWebAvailable, fetchWebState, snapshotToTui } from './web-client.js';
import { freePort } from './free-port.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Penny — interactive drift coach for design engineers.

Usage:
  penny                     Interactive browse (bundled demo, no Figma needed)
  penny scan                Rescan sources (for agent hooks / CI)
  penny scan --quiet        One-line summary (recommended in hooks)
  penny hooks               Show agent hook setup
  penny hooks --tutorial    Stepped CLI tutorial (same as onboarding)
  penny view                Launch web app and open browser
  penny view --drift=<n>    Deep-link to drift index n in the web app
  penny view --page=<id>    Deep-link to page id in the web app
  penny view --tutorial     Start with the onboarding tutorial
  penny onboarding          (Re)run onboarding -> ~/.driftrc  [aliases: init, onboard]
  penny --css <file>        Browse a single file

Scan options:
  --quiet                   Minimal output (hooks)
  --json                    Machine-readable output
  --local                   Skip web dashboard; scan in-process
  --hard                    Hard rescan — clear dismissals, fresh AI analysis
  --port <n>                Web dashboard port (default 5178)

Optional Figma baseline (else codebase-only scan):
  --figma-export <path>   Ingest a Figma REST export JSON
  --figma-file <key>      Live pull from the Figma API
  --figma-token <token>   Figma personal access token
  --list-tokens           Print values found in code and exit
  --help

Agent hooks (scan after each prompt):
  Claude Code:  .claude/settings.json  →  node hooks/penny-scan.js on Stop
  Cursor:       .cursor/hooks.json      →  node hooks/penny-scan.js on stop

Prefs live in ~/.driftrc. Env: FIGMA_TOKEN, FIGMA_FILE_KEY, AZURE_OPENAI_API_KEY.`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'figma-export': { type: 'string' }, 'figma-file': { type: 'string' }, 'figma-token': { type: 'string' },
    css: { type: 'string' }, tutorial: { type: 'boolean', default: false },
    drift: { type: 'string' }, page: { type: 'string' }, 'list-tokens': { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
    local: { type: 'boolean', default: false }, hard: { type: 'boolean', default: false }, port: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

function printHooksHelp() {
  console.log(hooksHelpText());
}

async function cmdHooksTutorial(cfg) {
  await runAgentHooksTutorial(cfg);
}

async function cmdScan(cfg) {
  const result = await runScan(cfg, {
    css: o.css,
    local: o.local,
    hard: o.hard,
    port: o.port,
    quiet: o.quiet,
    'figma-export': o['figma-export'],
    'figma-file': o['figma-file'],
    'figma-token': o['figma-token'],
  });
  if (o.json) {
    console.log(JSON.stringify(result));
    return;
  }
  if (o.quiet) {
    const extra = result.message ? ` · ${result.message}` : '';
    const tag = result.hard ? ' · hard' : '';
    console.log(`penny: ${result.total} drift${result.total !== 1 ? 's' : ''}${extra}${tag} (${result.via})`);
    return;
  }
  console.log(`Scan complete (${result.via})`);
  for (const line of formatScanLines(result)) console.log(line);
}

function openWeb(extraQuery = '') {
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'server.js');
  const port = Number(process.env.PORT || 5178);
  freePort(port);
  const q = extraQuery ? (extraQuery.startsWith('?') ? extraQuery : `?${extraQuery}`) : '';
  const url = `http://localhost:${port}${q}`;
  const child = spawn(process.execPath, [server], { stdio: 'inherit' });
  setTimeout(() => {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* no browser */ }
  }, 1200);
  return new Promise((resolve) => child.on('exit', resolve));
}

async function main() {
  if (o.help) { console.log(HELP); return; }
  if (positionals[0] === 'hooks') {
    const cfg = loadConfig();
    if (o.tutorial) {
      await cmdHooksTutorial(cfg);
      console.log('  \x1b[1mNext step:\x1b[0m  penny   or   penny view');
      console.log('');
      process.exit(0);
    }
    printHooksHelp();
    return;
  }
  if (['init', 'login', 'onboard', 'onboarding'].includes(positionals[0])) {
    const cfg = await onboard();
    if (cfg.quitAfterSetup) process.exit(0);
    return;
  }
  if (positionals[0] === 'scan') {
    const cfg = ensureProjectSources(loadConfig());
    await cmdScan(cfg);
    return;
  }
  if (positionals[0] === 'view') {
    const parts = [];
    const cfg = loadConfig();
    if (o.tutorial) parts.push('tutorial=1');
    if (o.page != null && o.page !== '') parts.push(`page=${encodeURIComponent(o.page)}`);
    if (o.drift != null && o.drift !== '') parts.push(`drift=${encodeURIComponent(o.drift)}`);
    await openWeb(parts.join('&'));
    return;
  }

  let cfg = loadConfig();
  if (!configExists() && !o['list-tokens'] && process.stdin.isTTY) {
    cfg = await onboard();
    if (cfg.quitAfterSetup) process.exit(0);
  } else {
    cfg = ensureProjectSources(cfg);
  }

  if (o.css && isDemoMode(cfg)) {
    console.error('Demo mode is limited to bundled seed pages. Run penny onboarding with an Azure OpenAI key to scan your own files.');
    process.exit(1);
  }

  const sources = loadSourcePages(cfg, o.css || null);
  if (!sources.length) {
    console.error(isDemoMode(cfg)
      ? 'Demo mode uses bundled seed pages — none found.'
      : 'No sources to scan (all excluded, or none configured).');
    return;
  }

  const port = Number(o.port || process.env.PORT || 5178);

  // Live mode: share session with the web dashboard when it's running.
  if (!isDemoMode(cfg) && !o.local && !o.css && !o['list-tokens'] && process.stdin.isTTY) {
    try {
      if (await isWebAvailable(port)) {
        const snap = await fetchWebState(port);
        if (!snap.demoMode) {
          const tuiData = snapshotToTui(snap, sources);
          process.stdout.write(`\nLinked to web dashboard — CLI syncs with the browser.\n`);
          process.stdout.write(`  http://localhost:${port}  ·  ${tuiData.problems.length} drift(s)\n\n`);
          await runTui({
            ...tuiData,
            webSync: { port, sources },
            agent: snap.agent || cfg.agent,
            demoMode: false,
          });
          process.exit(0);
        }
      }
    } catch { /* fall through to local scan */ }
  }

  process.stdout.write(`\nScanning ${sources.length} page(s)…\n`);
  const analysis = await analyzeAllPages({ pages: sources, cfg });
  const driftCount = analysis.pages.reduce((n, p) => n + (p.driftCount ?? p.drifts?.length ?? 0), 0);
  process.stdout.write(`Found ${driftCount} drift${driftCount !== 1 ? 's' : ''}.\n`);
  if (!isDemoMode(cfg) && !o.local) {
    process.stdout.write('Tip: run `penny view` in another terminal for live CLI ↔ web sync.\n');
  }
  process.stdout.write('\n');

  if (o['list-tokens']) {
    for (const t of analysis.panelTokens) console.log(`${t.type.padEnd(11)} ${t.name.padEnd(28)} ${t.count ?? ''}×  ${t.nodePath || ''}`);
    console.log(`\n${analysis.panelTokens.length} values found (${analysis.tokenMode} baseline)`);
    return;
  }

  if (!process.stdin.isTTY) { console.error('Not a TTY — run in a terminal to browse problems.'); return; }

  const apiKey = cfg.azureOpenAiKey || process.env.AZURE_OPENAI_API_KEY || '';
  await runTui({
    pages: sources,
    pageResults: analysis.pages,
    tokens: analysis.panelTokens,
    diffTokens: analysis.diffTokens,
    tokenMode: analysis.tokenMode,
    agent: cfg.agent,
    apiKey: apiKey || null,
    demoMode: analysis.demoMode,
  });
  process.exit(0);
}

main().catch((err) => { console.error(`\x1b[31mError:\x1b[0m ${err.message}`); process.exit(1); });
