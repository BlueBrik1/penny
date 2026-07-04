#!/usr/bin/env node
// Agent hook entrypoint — always exit 0 (never block the agent).
// Claude Code Stop: reads stdin JSON; skips when stop_hook_active is true.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  try {
    const raw = await readStdin();
    if (raw) {
      try {
        const input = JSON.parse(raw);
        if (input.stop_hook_active === true) process.exit(0);
      } catch { /* not JSON — fine */ }
    }
  } catch { /* no stdin */ }

  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
  const r = spawnSync(process.execPath, [cli, 'scan', '--quiet'], {
    cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(r.status === 0 ? 0 : 0);
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(''); return; }
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
    setTimeout(() => resolve(buf), 200);
  });
}

main();
