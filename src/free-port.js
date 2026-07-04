import { execSync } from 'node:child_process';

/** Stop whatever is listening on `port` so a fresh Penny server can bind. */
export function freePort(port) {
  try {
    if (process.platform === 'win32') {
      execSync(
        `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
        { stdio: 'ignore', shell: 'powershell.exe' },
      );
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore', shell: true });
    }
  } catch { /* port already free */ }
}
