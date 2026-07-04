// Install agent hook files into the user's project (scan after each agent turn).

import fs from 'node:fs';
import path from 'node:path';

const HOOK_SCRIPT = `#!/usr/bin/env node
// Penny agent hook — rescan after each agent turn when scanMode is 'agent' (always exit 0).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function scanMode() {
  const rc = process.env.DRIFTRC || path.join(os.homedir(), '.driftrc');
  try { return JSON.parse(fs.readFileSync(rc, 'utf8')).scanMode || 'ondemand'; }
  catch { return 'ondemand'; }
}

if (scanMode() === 'agent') {
  spawnSync('penny', ['scan', '--quiet'], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
}
process.exit(0);
`;

const CLAUDE_HOOK = {
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'node hooks/penny-scan.js' }] }],
  },
};

const CURSOR_HOOK = {
  version: 1,
  hooks: {
    stop: [{ command: 'node hooks/penny-scan.js' }],
  },
};

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function mergeClaudeSettings(file) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new */ }
  cur.hooks = cur.hooks || {};
  cur.hooks.Stop = CLAUDE_HOOK.hooks.Stop;
  writeJson(file, cur);
}

function mergeCursorHooks(file) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new */ }
  cur.version = CURSOR_HOOK.version;
  cur.hooks = { ...cur.hooks, ...CURSOR_HOOK.hooks };
  writeJson(file, cur);
}

/** Create hooks/penny-scan.js plus Claude Code and Cursor hook configs in projectRoot. */
export function installAgentHooks(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  const hooksDir = path.join(root, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(path.join(hooksDir, 'penny-scan.js'), HOOK_SCRIPT);

  const claude = path.join(root, '.claude', 'settings.json');
  const cursor = path.join(root, '.cursor', 'hooks.json');
  mergeClaudeSettings(claude);
  mergeCursorHooks(cursor);

  return {
    hookScript: path.join(hooksDir, 'penny-scan.js'),
    claude,
    cursor,
  };
}
