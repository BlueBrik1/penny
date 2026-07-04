# Penny

Penny is an interactive design-token drift coach for CSS and JSX. It scans your frontend source, finds inconsistent colors, spacing, and typography, and helps you fix them — with a terminal UI, a web dashboard, one-click applies, and optional Figma baselines.

Penny uses **Azure OpenAI** to explain each drift in plain language and suggest concrete line-level edits. Without a Figma file, it builds an **intrinsic token inventory** from your codebase and flags value drift, inconsistent usage, off-palette colors, and off-scale spacing.

---

## Requirements

- **Node.js 18+**
- **Azure OpenAI** API key (required for scans and AI explanations)
- Your frontend project with `.css`, `.scss`, `.jsx`, `.tsx`, `.vue`, or `.svelte` files
- For React/Vite live previews: a running dev server (e.g. `npm run dev` on port 3000 or 5173)

---

## Installation

Clone or download this repo, then install dependencies and link the CLI:

```bash
cd penny          # or your clone path
npm install
npm link          # installs the `penny` command globally
```

Alternatively, run without linking:

```bash
node src/cli.js
node src/cli.js view
```

Verify:

```bash
penny --help
```

---

## Quick start

1. **Run onboarding** (writes config to `~/.driftrc`):

   ```bash
   penny onboarding
   ```

   You will be prompted for:
   - Azure OpenAI API key (required)
   - Optional Figma credentials
   - Which AI agent you use (for “Ask agent” prompts)
   - Scan frequency
   - Project folder to scan (auto-discovers CSS/JSX)
   - Dev server port for React previews

2. **Start the web dashboard** (recommended):

   ```bash
   penny view
   ```

   Opens `http://127.0.0.1:5178` by default. First load runs AI analysis on each page (can take a few minutes).

3. **Use the terminal UI** (syncs with the web app when it is running):

   ```bash
   penny
   ```

   If `penny view` is already open, the CLI links instantly and stays in sync via Server-Sent Events.

---

## Commands

| Command | Description |
|---------|-------------|
| `penny` | Interactive terminal browser (TUI) |
| `penny view` | Start web server and open browser |
| `penny view --tutorial` | Open dashboard with onboarding tour |
| `penny view --page=<id>` | Deep-link to a page tab |
| `penny view --drift=<n>` | Deep-link to drift index on current page |
| `penny scan` | Rescan all configured sources |
| `penny scan --quiet` | One-line summary (for agent hooks / CI) |
| `penny scan --json` | Machine-readable scan output |
| `penny scan --local` | Scan in-process, skip web dashboard |
| `penny scan --hard` | Clear dismissals and rerun full AI analysis |
| `penny scan --port <n>` | Web dashboard port (default **5178**) |
| `penny onboarding` | (Re)run setup → `~/.driftrc` |
| `penny hooks` | Show agent hook installation help |
| `penny hooks --tutorial` | Walkthrough for post-prompt scanning |
| `penny --css <file>` | Browse drifts for a single file |
| `penny --list-tokens` | Print token inventory and exit |
| `penny --help` | Full CLI help |

**Optional Figma baseline flags** (instead of intrinsic/code-only mode):

| Flag | Description |
|------|-------------|
| `--figma-export <path>` | Offline Figma REST export JSON |
| `--figma-file <key>` | Live pull from Figma API |
| `--figma-token <token>` | Figma personal access token |

---

## Configuration (`~/.driftrc`)

All preferences persist in JSON at `~/.driftrc` (override path with `DRIFTRC` env var).

```json
{
  "azureOpenAiKey": "...",
  "azureOpenAiEndpoint": "https://your-resource.openai.azure.com",
  "azureOpenAiDeployment": "your-deployment",
  "azureOpenAiApiVersion": "2025-01-01-preview",
  "figmaToken": "",
  "figmaFileKey": "",
  "figmaFrameNode": "",
  "figmaUrl": "",
  "agent": "Claude Code",
  "scanMode": "ondemand",
  "intervalMinutes": 5,
  "projectRoot": "/path/to/frontend",
  "previewDevServer": "http://localhost:3000",
  "exclude": ["vendor/old.css"],
  "sources": [
    { "id": "landing", "name": "Landing", "src": "src/Landing.css", "html": "src/Landing.html" }
  ],
  "dismissedItems": [],
  "onboardingComplete": true,
  "tutorialComplete": false
}
```

### Key fields

| Field | Purpose |
|-------|---------|
| `sources` | Pages to scan — auto-populated during onboarding |
| `projectRoot` | Root folder; source paths are relative to this |
| `previewDevServer` | URL of your Vite/CRA dev server for React iframe previews |
| `scanMode` | When rescans run (see [Scan modes](#scan-modes)) |
| `exclude` | Path substrings to skip during discovery |
| `dismissedItems` | Per-page, per-element dismissals the AI must not repeat |

Re-run `penny onboarding` anytime to change project folder, API key, or scan mode.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `AZURE_OPENAI_API_KEY` | API key (overridden by config if set there) |
| `AZURE_OPENAI_ENDPOINT` | Azure resource endpoint |
| `AZURE_OPENAI_DEPLOYMENT` | Model deployment name |
| `AZURE_OPENAI_API_VERSION` | API version string |
| `FIGMA_TOKEN` | Figma personal access token |
| `FIGMA_FILE_KEY` | Figma file key from URL |
| `FIGMA_FRAME_NODE` | Frame node id (e.g. `12:34`) |
| `FIGMA_EXPORT` | Path to offline Figma export JSON |
| `PORT` | Web dashboard port (default 5178) |
| `DRIFTRC` | Alternate config file path |
| `DRIFT_CACHE` | Alternate boot cache path (default `~/.driftcache.json`) |

---

## What Penny detects

Penny classifies each issue into categories:

| Category | Meaning |
|----------|---------|
| **value-drift** | A literal is close to but not equal to the canonical token |
| **inconsistent-usage** | Multiple similar values used where one token should win (e.g. five slightly different oranges) |
| **off-palette** | A color with no nearby token in the inventory |
| **off-scale** | Spacing or type size not on the detected scale |

Severity is **high**, **medium**, or **low**. Only **value-drift** and **inconsistent-usage** get automatic line-level fixes; off-palette/off-scale items are advisory.

Supported source formats: plain CSS, SCSS, Tailwind class strings in JSX/TSX, inline styles, Vue/Svelte single-file components.

---

## Web dashboard (`penny view`)

The dashboard has five main areas:

1. **Summary bar** — drift count, alignment score, severity filters, Group/Map toggles, rescan buttons, Figma embed, tutorial
2. **Live preview** — rendered page with spotlight and drift-map overlays
3. **Problems panel** — step through drifts; comparison “cinema” for design vs shipped values
4. **Token inventory** — every color/spacing/type value found; click to jump to related drifts
5. **Source code** — syntax-highlighted file with drift markers and inline fix preview

### Web keyboard shortcuts

Press **h** in the summary bar or anywhere (when not typing in an input):

| Key | Action |
|-----|--------|
| `↑` / `↓` or `←` / `→` | Previous / next drift |
| `f` | Apply fix for current drift |
| `a` | Apply all fixable drifts on this page |
| `d` | Dismiss current suggestion |
| `g` | Toggle **group mode** (cluster drifts by token family) |
| `m` | Toggle **drift map** (severity-colored outlines on preview) |
| `/` | Open drift search |
| `h` | Toggle shortcuts help |
| `Esc` | Close modals |

### Web actions (buttons)

- **Rescan** — re-run analysis from disk (keeps dismissals)
- **Hard rescan** — wipe dismissals + boot cache, fresh AI pass
- **Fix this / Fix group / Apply all** — write edits to source files
- **Ask agent** — copy a structured prompt to clipboard
- **Dismiss** — hide this suggestion for this page + element (AI will not re-suggest similar issues there)
- **Restore dismissed** — undo all dismissals
- **Revert page / Revert all** — restore original file contents from before fixes
- **CLI** — copy a `penny view --page=… --drift=…` deep link
- **Tutorial** — guided tour of the dashboard

### Live preview modes

| Source type | Preview behavior |
|-------------|------------------|
| CSS + companion HTML | Inline sandbox iframe |
| CSS only | Auto-generated HTML from class names |
| Standalone JSX (Tailwind) | Babel + Tailwind CDN sandbox, or dev-server proxy if configured |
| Multi-import JSX | Proxies through `previewDevServer` (set during onboarding) |

Set `previewDevServer` in config (e.g. `http://localhost:5173`) and run your dev server so React pages render with real routing and imports.

---

## Terminal UI (`penny`)

The TUI is a two-column layout: drift list + details on the left, code or token view on the right.

### CLI keyboard shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` | Cycle drifts on current page |
| `←` / `→` | Previous / next page tab |
| `[` / `]` | Scroll page tabs when many pages |
| `{` / `}` | Scroll left panel |
| `PgUp` / `PgDn` (or `Ctrl+P` / `Ctrl+N`) | Scroll code/token pane |
| `Enter` | Open fix menu for current drift |
| `a` | Apply all fixes on current page |
| `c` | Copy “Ask agent” prompt |
| `x` | Dismiss current drift |
| `t` | Toggle token inventory view |
| `g` | Toggle group mode |
| `m` | Toggle heatmap highlights in code view |
| `r` | Rescan (when synced to web dashboard) |
| `=` | Hard rescan (clear dismissals, fresh AI) |
| `h` | Toggle help overlay |
| `q` / `Esc` | Quit |
| `Ctrl+C` | Quit |

### Fix menu (`Enter` on a drift)

1. Apply this solution (when line-level fix exists)
2. Fix group (when group mode clusters related drifts)
3. Apply all fixes on this file
4. Ask your agent (copy prompt)

### CLI ↔ web sync

When `penny view` is running on the default port:

- Running `penny` connects instantly to the web session
- Fixes, dismissals, and rescans in either UI update the other via SSE
- The CLI reads source from disk (not stale in-memory copies from the web payload)

If the web server is not running, Penny loads from **boot cache** (`~/.driftcache.json`) when source files are unchanged, or runs a full local scan.

---

## Scan modes

Set during onboarding or by editing `scanMode` in `~/.driftrc`:

| Mode | Behavior |
|------|----------|
| `ondemand` | Rescan only when you click Rescan or run `penny scan` |
| `agent` | Hook runs `penny scan --quiet` after each AI agent turn |
| `watch` | Rescan on file save (can be expensive) |
| `interval` | Rescan every N minutes (`intervalMinutes`) |
| `autonomous` | Watch + auto-apply all fixable drifts |

Choosing **agent** mode during onboarding installs hooks into `.claude/settings.json` and `.cursor/hooks.json`.

---

## Agent hooks

Penny can rescan after every AI coding session so drift counts stay current while you pair with Claude Code or Cursor.

```bash
penny hooks              # installation paths and manual test commands
penny hooks --tutorial   # step-by-step walkthrough
```

The hook script (`hooks/penny-scan.js`) always exits 0 so it never blocks your agent. It runs:

```bash
penny scan --quiet
```

**Claude Code:** `.claude/settings.json` → Stop hook  
**Cursor:** `.cursor/hooks.json` → stop hook  

Reload Cursor after editing hooks. Use your agent from the project root where hooks are installed.

---

## Figma integration (optional)

Penny works without Figma. When connected, drifts compare against Figma variables/styles instead of the intrinsic inventory.

**Live API:** set `figmaToken`, `figmaFileKey`, and optionally `figmaFrameNode` in config or env.

**Offline export:** pass `--figma-export path/to/export.json` or set `FIGMA_EXPORT`.

The web dashboard can embed your Figma frame for side-by-side reference when `figmaUrl` or file key is configured.

---

## Dismissals

When you dismiss a suggestion, Penny records **page + element + category + type** in `dismissedItems`. Future AI scans:

- Receive dismissed elements in the prompt (“do not report these again”)
- Filter out similar drifts post-analysis via `isSimilarDismissed`

Dismissals are scoped to the specific element on that page — not codebase-wide.

**Hard rescan** (`=` in CLI, or Hard rescan in web) clears all dismissals and boot cache for a completely fresh pass.

---

## Boot cache

First scan runs AI on every page and can take several minutes. Results are cached at `~/.driftcache.json` keyed by source file mtimes. Subsequent `penny` / `penny view` starts load instantly until sources change or you hard-rescan.

---

## Project layout

```
src/
  cli.js              CLI entry (`penny` command)
  tui.js              Terminal UI
  config.js           ~/.driftrc read/write + onboarding
  pipeline.js         Multi-page scan orchestration
  ai-analyze.js       Azure OpenAI drift analysis
  scan.js             `penny scan` + local scan helpers
  fixer.js            Line-level fix plans and apply
  dismiss.js          Per-element dismissal tracking
  discover-sources.js Auto-detect CSS/JSX in a folder
  preview.js          Preview document generation
  preview-sidecar.js  Dev-server proxy for React previews
  drift-map.js        Map overlays in preview iframe
  figma.js            Figma API + export parsing
  boot-cache.js       Shared scan cache
web/
  server.js           HTTP API + SSE (`penny view`)
  app.jsx             React dashboard
  penny-bridge.js     postMessage bridge for preview iframes
hooks/
  penny-scan.js       Agent hook entrypoint
test/
  fixtures/           Sample CSS/JSX/HTML for unit tests
```

---

## Development

```bash
npm test              # run unit tests (node --test)
npm run web           # start web server only (no browser)
npm start             # same as `penny`
```

Tests use fixtures in `test/fixtures/` — not bundled demo data.

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| “Azure OpenAI API key required” | Run `penny onboarding` |
| “No sources to scan” | Re-run onboarding; point at your frontend root |
| Empty CLI with garbled text | Fixed in recent builds; ensure Windows CRLF sources load via disk sync |
| React preview blank | Set `previewDevServer` and run `npm run dev` |
| Drift map missing on React dev server | Ensure dev server is running; map uses `penny-bridge.js` postMessage |
| Slow first load | Normal — AI analyzes each page once; cache speeds up later runs |
| CLI not syncing with web | Start `penny view` first, then `penny` in another terminal on port 5178 |

---

## License

See repository for license terms.
