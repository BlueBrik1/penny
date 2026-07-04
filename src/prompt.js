// Minimal arrow-key prompts for the CLI: a single-select list and a text input.
// select() is fully keyboard-driven (up/down, enter, esc) with one clear marker
// (inverted row, no second glyph) and renders in place to avoid flicker.
// select() is fully keyboard-driven (up/down, enter, esc) on all platforms.

import readline from 'node:readline';

const HOME = '\x1b[H\x1b[0J';       // cursor home + clear to end (no full-screen wipe -> no flicker)
const HIDE = '\x1b[?25l', SHOW = '\x1b[?25h';
const C = { q: '\x1b[36m', dim: '\x1b[2m', inv: '\x1b[7m', reset: '\x1b[0m' };

function releaseStdin() {
  if (process.stdin.isPaused()) process.stdin.resume();
}

export function select(question, options, initial = 0) {
  return new Promise((resolve) => {
    let i = Math.max(0, Math.min(initial, options.length - 1));
    let armed = false;
    let onKey;

    const render = () => {
      let b = `${HOME}${C.q}?${C.reset} ${question}\n\n`;
      options.forEach((o, idx) => {
        b += idx === i ? `${C.inv} ${o.label} ${C.reset}\n` : `   ${o.label}\n`;
      });
      b += `\n${C.dim}up/down move   enter select   esc back${C.reset}`;
      process.stdout.write(b);
    };

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKey);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdout.write(SHOW + '\n');
      releaseStdin();
    };

    onKey = (ch, key) => {
      if (!armed || !key?.name) return;
      if (key.name === 'up') i = (i - 1 + options.length) % options.length;
      else if (key.name === 'down') i = (i + 1) % options.length;
      else if (key.name === 'return') { cleanup(); return resolve(options[i].value); }
      else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) { cleanup(); return resolve(null); }
      else return;
      render();
    };

    // Defer raw mode until readline from prior input() has fully released stdin.
    setImmediate(() => {
      releaseStdin();
      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdout.write(HIDE);
      process.stdin.on('keypress', onKey);
      render();
      // Swallow spurious enter from the previous readline prompt (common on Windows).
      setTimeout(() => { armed = true; }, 120);
    });
  });
}

// Text input (for tokens / keys / paths). Blank keeps the default. `help` is an optional
// multi-line walkthrough rendered above the prompt (dimmed).
export function pause(message = 'Press Enter to continue') {
  return new Promise((resolve) => {
    releaseStdin();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(`${C.dim}${message}${C.reset}`, () => {
      rl.close();
      releaseStdin();
      resolve();
    });
  });
}

export function input(question, def = '', help = '') {
  return new Promise((resolve) => {
    let head = HOME;
    if (help) head += help.split('\n').map((l) => `${C.dim}${l}${C.reset}`).join('\n') + '\n\n';
    process.stdout.write(head);
    releaseStdin();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(`${C.q}?${C.reset} ${question}${def ? ` ${C.dim}(${def})${C.reset}` : ''}: `, (a) => {
      rl.close();
      releaseStdin();
      resolve(a.trim() || def);
    });
  });
}
