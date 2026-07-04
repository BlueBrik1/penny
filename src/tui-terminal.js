// Terminal-safe text helpers for the CLI TUI (Windows + long / messy source lines).

/** Normalize line endings when reading source from disk. */
export function normalizeSource(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Strip control chars that break fixed-width terminal columns. */
export function termSafe(text) {
  return String(text ?? '')
    .replace(/\r/g, '')
    .replace(/\t/g, '  ')
    .replace(/\n/g, ' ');
}
