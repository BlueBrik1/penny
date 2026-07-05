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
import { hasApiKey } from './demo-mode.js';
import { isWebAvailable, fetchWebState, snapshotToTui, waitForWebServer, fetchWebHealth, waitForWebReady } from './web-client.js';
import { readBootCache, writeBootCache, cacheToAnalysis } from './boot-cache.js';
import { freePort } from './free-port.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLD_BOOT_MSG = 'This may take up to 5 minutes on first load.';

const HELP = `Penny — interactive drift coach for design engineers.

Usage:
  penny                     Interactive browse
  penny scan                Rescan sources (for agent hooks / CI)
  penny scan --quiet        One-line summary (recommended in hooks)
  penny hooks               Show agent hook setup
  penny hooks --tutorial    Agent hooks walkthrough
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
  --no-ai                   Rules-only scan; never call the LLM (implies --local)
  --fail-on-drift           Exit 1 if any drift is found (CI gate)
  --verbose-json            With --json, include full drift details per page
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
    'no-ai': { type: 'boolean', default: false }, 'fail-on-drift': { type: 'boolean', default: false },
    'verbose-json': { type: 'boolean', default: false },
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
  // --no-ai forces the in-process rules path (never hits the web server or LLM).
  const noAi = o['no-ai'];
  const result = await runScan(cfg, {
    css: o.css,
    local: o.local || noAi,
    hard: o.hard,
    port: o.port,
    quiet: o.quiet,
    noAi,
    verboseJson: o['verbose-json'],
    'figma-export': o['figma-export'],
    'figma-file': o['figma-file'],
    'figma-token': o['figma-token'],
  });
  const failing = o['fail-on-drift'] && result.total > 0;
  if (o.json) {
    console.log(JSON.stringify(result));
    if (failing) process.exit(1);
    return;
  }
  if (o.quiet) {
    const extra = result.message ? ` · ${result.message}` : '';
    const tag = result.hard ? ' · hard' : '';
    console.log(`penny: ${result.total} drift${result.total !== 1 ? 's' : ''}${extra}${tag} (${result.via})`);
    if (failing) process.exit(1);
    return;
  }
  console.log(`Scan complete (${result.via})`);
  for (const line of formatScanLines(result)) console.log(line);
  if (failing) process.exit(1);
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', shell: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch { /* no browser */ }
}

async function openWeb(extraQuery = '') {
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'server.js');
  const port = Number(o.port || process.env.PORT || 5178);
  freePort(port);
  const q = extraQuery ? (extraQuery.startsWith('?') ? extraQuery : `?${extraQuery}`) : '';
  const url = `http://127.0.0.1:${port}${q}`;
  process.stdout.write('\nStarting Penny web server…\n');
  const child = spawn(process.execPath, [server], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port) },
  });
  const ready = await waitForWebServer(port);
  if (ready) {
    process.stdout.write(`\x1b[36mPenny\x1b[0m → \x1b[1m${url}\x1b[0m\n`);
    process.stdout.write('Opening in your browser… (Ctrl+C here to stop the server)\n\n');
    openBrowser(url);
  } else {
    process.stderr.write(`\n\x1b[33mCould not reach the server on port ${port}.\x1b[0m\n`);
    process.stderr.write(`  Open manually: ${url}\n`);
    process.stderr.write('  If the server is still loading AI scans, wait and refresh.\n\n');
  }
  return new Promise((resolve) => child.on('exit', resolve));
}

async function main() {
  if (o.help) { console.log(HELP); return; }

  // Scans run rule-based with no key; only interactive/onboarding needs credentials.
  const keyOptionalCmd = ['init', 'login', 'onboard', 'onboarding', 'hooks', 'scan'].includes(positionals[0]);
  if (!keyOptionalCmd && !hasApiKey(loadConfig())) {
    console.error('\x1b[31mAzure OpenAI API key required.\x1b[0m Run \x1b[1mpenny onboarding\x1b[0m to set up.\n');
    process.exit(1);
  }

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
  } else {
    cfg = ensureProjectSources(cfg);
  }

  if (!hasApiKey(cfg)) {
    console.error('\x1b[31mAzure OpenAI API key required.\x1b[0m Run \x1b[1mpenny onboarding\x1b[0m to set up.\n');
    process.exit(1);
  }

  if (o.css && !hasApiKey(cfg)) {
    console.error('API key required. Run penny onboarding.');
    process.exit(1);
  }

  const sources = loadSourcePages(cfg, o.css || null);
  if (!sources.length) {
    console.error('No sources to scan (all excluded, or none configured). Run \x1b[1mpenny onboarding\x1b[0m.');
    return;
  }

  const port = Number(o.port || process.env.PORT || 5178);

  // Live mode: share session with the web dashboard when it's running.
  if (!o.local && !o.css && !o['list-tokens'] && process.stdin.isTTY) {
    try {
      if (await isWebAvailable(port)) {
        const health = await fetchWebHealth(port);
        const instant = !!health.ready;
        if (!instant) {
          process.stdout.write(`\nConnecting to web dashboard — ${COLD_BOOT_MSG}\n`);
          await waitForWebReady(port);
        }
        const snap = await fetchWebState(port);
        const tuiData = snapshotToTui(snap, sources);
        process.stdout.write(instant
          ? `\nLinked to web dashboard — synced instantly.\n`
          : `\nLinked to web dashboard — CLI syncs with the browser.\n`);
        process.stdout.write(`  http://localhost:${port}  ·  ${tuiData.problems.length} drift(s)\n\n`);
        await runTui({
          ...tuiData,
          webSync: { port, sources },
          agent: snap.agent || cfg.agent,
        });
        process.exit(0);
      }
    } catch { /* fall through to cache or local scan */ }
  }

  if (!o.local && !o.css && !o['list-tokens'] && process.stdin.isTTY) {
    const cached = readBootCache(cfg);
    if (cached) {
      const analysis = cacheToAnalysis(cached, sources);
      const driftCount = analysis.pages.reduce((n, p) => n + (p.driftCount ?? p.drifts?.length ?? 0), 0);
      process.stdout.write(`\nLoaded cached scan — synced instantly.\n`);
      process.stdout.write(`  ${driftCount} drift${driftCount !== 1 ? 's' : ''}\n\n`);
      if (o['list-tokens']) {
        for (const t of analysis.panelTokens) console.log(`${t.type.padEnd(11)} ${t.name.padEnd(28)} ${t.count ?? ''}×  ${t.nodePath || ''}`);
        console.log(`\n${analysis.panelTokens.length} values found (${analysis.tokenMode} baseline)`);
        return;
      }
      await runTui({
        pages: sources,
        pageResults: analysis.pages,
        tokens: analysis.panelTokens,
        diffTokens: analysis.diffTokens,
        tokenMode: analysis.tokenMode,
        agent: cfg.agent,
        apiKey: cfg.azureOpenAiKey || process.env.AZURE_OPENAI_API_KEY || '',
      });
      process.exit(0);
    }
  }

  process.stdout.write(`\nScanning ${sources.length} page(s)… ${COLD_BOOT_MSG}\n`);
  const analysis = await analyzeAllPages({ pages: sources, cfg });
  writeBootCache(cfg, {
      tokens: analysis.panelTokens,
      diffTokens: analysis.diffTokens,
      tokenMode: analysis.tokenMode,
      pages: sources.map((s) => ({
        id: s.id,
        drifts: analysis.pages.find((p) => p.id === s.id)?.drifts || [],
      })),
  });
  const driftCount = analysis.pages.reduce((n, p) => n + (p.driftCount ?? p.drifts?.length ?? 0), 0);
  process.stdout.write(`Found ${driftCount} drift${driftCount !== 1 ? 's' : ''}.\n`);
  if (!o.local) {
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
  });
  process.exit(0);
}

main().catch((err) => { console.error(`\x1b[31mError:\x1b[0m ${err.message}`); process.exit(1); });
