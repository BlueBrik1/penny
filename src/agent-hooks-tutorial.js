// CLI walkthrough for scanMode: 'agent' — rescan when an AI agent finishes a turn.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pause } from './prompt.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const C = { bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', reset: '\x1b[0m' };

function hookPath() {
  return process.platform === 'win32' ? 'node hooks\\penny-scan.js' : 'node hooks/penny-scan.js';
}

function hooksPresent() {
  return fs.existsSync(path.join(ROOT, 'hooks', 'penny-scan.js'));
}

function agentNotes(agent) {
  switch (agent) {
    case 'Claude Code':
      return [
        'Claude Code reads .claude/settings.json in this project.',
        'The Stop hook is already wired to run penny scan after each turn.',
        'Use Claude Code from this repo root so the hook loads.',
      ];
    case 'Cursor':
      return [
        'Cursor reads .cursor/hooks.json in this project.',
        'The stop hook is already wired to run penny scan after each turn.',
        'Reload the Cursor window once if you edit hooks.json.',
      ];
    default:
      return [
        `You chose ${agent}. Wire its "session end" or "stop" hook to:`,
        `  ${hookPath()}`,
        'See your agent docs for hook configuration.',
      ];
  }
}

export function hooksHelpText() {
  const hook = hookPath();
  const abs = path.join(ROOT, 'hooks', 'penny-scan.js');
  return `Penny agent hooks — rescan after each agent turn

This repo includes:
  .claude/settings.json   Claude Code Stop hook
  .cursor/hooks.json      Cursor stop hook
  hooks/penny-scan.js     Wrapper (always exit 0; runs: penny scan --quiet)

Manual test:
  ${hook}
  penny scan
  penny scan --quiet
  penny scan --json

Claude Code: hooks fire from project root. Ensure Penny is on PATH or use:
  node ${abs}

Cursor: reload window after editing .cursor/hooks.json`;
}

/** Stepped CLI tutorial shown when onboarding selects scanMode: agent. */
export async function runAgentHooksTutorial(cfg = {}) {
  const agent = cfg.agent || 'Claude Code';
  const hook = hookPath();
  const steps = [
    {
      title: 'How it works',
      lines: [
        'Penny will rescan your CSS/JSX each time your AI agent finishes a prompt.',
        '',
        'A small hook script runs:  penny scan --quiet',
        '',
        'If penny view is open, the dashboard updates live.',
        'Otherwise Penny scans from disk in the background.',
      ],
    },
    {
      title: 'Hook files in this repo',
      lines: hooksPresent()
        ? [
            `${C.green}✓${C.reset} hooks/penny-scan.js`,
            `${C.green}✓${C.reset} .claude/settings.json  (Claude Code Stop)`,
            `${C.green}✓${C.reset} .cursor/hooks.json      (Cursor stop)`,
            '',
            'No extra setup needed when you work in this project.',
          ]
        : [
            'Copy hooks/penny-scan.js and hook config from the Penny repo, or run:',
            `  ${hook}`,
            'from your project root after adding the hook files.',
          ],
    },
    {
      title: 'Try it now',
      lines: [
        '1. Start the dashboard (optional):  penny view',
        `2. Run the hook manually:           ${hook}`,
        '3. You should see:                  penny: N drifts (web) or (local)',
        '',
        'Run penny hooks anytime for the full reference.',
      ],
    },
    {
      title: `Your agent — ${agent}`,
      lines: agentNotes(agent),
    },
  ];

  process.stdout.write('\n');
  console.log(`${C.bold}Agent scan tutorial${C.reset}  ${C.dim}(scan when your agent finishes)${C.reset}\n`);

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    console.log(`${C.cyan}Step ${i + 1}/${steps.length}${C.reset}  ${C.bold}${s.title}${C.reset}\n`);
    for (const line of s.lines) console.log(`  ${line}`);
    console.log('');
    if (i < steps.length - 1) await pause('Press Enter for next step');
  }
}
