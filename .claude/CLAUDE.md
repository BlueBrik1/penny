# Project: Token Drift Detector (RAISE Hackathon)

Solo build. CLI binary name: **`penny`**.

## Problem Statement

**Who:** Design engineers and frontend devs shipping UI from Figma.

**Day-to-day pain:** Tokens live in Figma; code drifts invisibly (`#ff6b35` vs `#ff6a34`). Mismatches surface late — in PR review, QA, or when a designer pings "that's not the orange." Explaining why it matters and what to change is slow and repetitive.

**Product promise:** Penny is an **interactive drift coach** — not a static linter. It shows the mismatch visually (comparison cinema), narrates why it matters (voice), and walks you to a fix.

**User journey:** Connect → Scan & summarize → See & hear the drift → Fix → Verify.

## Scope Decision

Diff Figma design tokens against deployed code and surface semantic mismatches — via **Guided tour** (demo/first-run) or **Dashboard** (power users), in CLI and web.

Not building: visual regression classifier, chat intent-matcher.

---

## What is done

Everything below is implemented, tested, and wired end-to-end.

### Core pipeline (`src/`)

1. **Figma token pull** (`figma.js`)
   - Live REST pull: styles → nodes → variables (variables 403 is tolerated on non-Enterprise accounts).
   - Offline path: ingest a Figma REST export JSON (`seed/figma-export.json`).
   - Normalized token shape: `{ name, type, nodePath?, value, color?, px?, font? }`.
   - Live frame fetch: PNG render + flattened node geometry for overlay/spotlight (`fetchFigmaFrame`, `flattenFrameNodes`).

2. **Design-language-agnostic source parser** (`parse.js`, `css.js`, `color.js`)
   - **CSS / SCSS / LESS** via postcss — colors, spacing, typography with file/line/selector.
   - **JSX / TSX / JS / TS / HTML / Vue / Svelte** via markup scan:
     - Tailwind arbitrary values (`bg-[#ff6b35]`, `text-[18px]`, `p-[10px]`).
     - Tailwind numeric scale (`p-4`, `mt-6`, … → `n * 4px`).
     - Inline hex/rgb colors.
   - Each usage carries `{ raw, syntax }` so fixes render back in the same language (CSS stays CSS, Tailwind stays Tailwind).
   - Comments blanked so prose hex/classes are not false positives.

3. **Semantic diff** (`diff.js`)
   - Colors: perceptual clustering (redmean distance, threshold 30) — `#ff6b35` and `#ff6a34` collapse to one token.
   - Spacing / typography: proportional tolerance (±12% of token value).
   - Four drift categories:
     - `value-drift` — one wrong value where a token was clearly intended.
     - `inconsistent-usage` — one token rendered as several near-duplicate values (headline demo drift).
     - `hardcoded` — literal equals a token but doesn't reference it.
     - `off-palette` / `off-scale` — value with no matching token.
   - Severity ranking: high / medium / low.

4. **Claude reasoning** (`claude.js`)
   - **Live**: one batched Sonnet call (`claude-sonnet-5`) over all drifts; merges `{ severity, why, fix }` by id.
   - **Offline**: deterministic rule-based explainer when no API key (web + CLI default).
   - Fallback to offline explainer for any drift missing from Claude output.

5. **Fix engine** (`fixer.js`)
   - `computeFixPlan` → per-line before/after edits.
   - `applyPlan` — apply all, or only selected drift ids.
   - `renderCanonical` — writes canonical values back in CSS or Tailwind syntax.
   - Auto-fixable: `value-drift` and `inconsistent-usage` only.
   - `driftKey` — stable identity for dismissals across rescans.

### CLI onboarding & config (`config.js`, `prompt.js`)

- First run (no `~/.driftrc`) drops into keyboard-driven onboarding.
- `penny init` / `penny onboarding` re-runs it.
- Persisted to **`~/.driftrc`** (override with `DRIFTRC` env):
  - Figma token, file key, frame node id, embed URL.
  - Anthropic API key.
  - Agent choice for "Ask your agent" (Claude Code, Cursor, Windsurf, Copilot, Other).
  - Scan mode: `ondemand` | `watch` | `interval` | `autonomous`.
  - Interval minutes (when mode is `interval`).
  - Source list (`sources: [{ id, name, src, html? }]`).
  - Excluded path substrings (`exclude: []`).
  - Dismissed drift keys (`dismissed: []`).
  - UI mode: `uiMode: 'dashboard' | 'tour'`.
  - Voice narration toggle (`voiceEnabled: true`).
- Onboarding: arrow keys + Enter + Esc everywhere; typing only for tokens/keys/paths.

### Interactive CLI (`cli.js`, `tui.js`)

- **`penny`** — scan configured sources, open interactive problem browser.
- **`penny view`** — launch web app and open browser.
- **`penny --css <file>`** — single-file scan.
- **`penny --list-tokens`** — dump parsed tokens.
- Layout mirrors the web app right side:
  - Left: current problem (severity, category, expected/found, why, fix).
  - Right: full source file with gutter markers, inline red/green diff for fixable drifts.
  - Per-source tabs with problem counts.
- Navigation: ↑/↓ cycle problems, ←/→ switch sources, PgUp/PgDn scroll code, Enter → fix menu, Esc back/quit.
- **Fix modes** (Enter menu or shortcuts):
  1. Apply this solution
  2. Apply all fixes on this file
  3. Ask your agent — copies structured prompt to clipboard
- Shortcuts: `a` apply all, `c` ask agent, `x` dismiss suggestion.
- Writes fixes directly to source files.

### UX expansion (Guided tour + comparison cinema + voice)

- **Two UI modes:** Guided tour (step-through journey) and Dashboard (power layout). Toggle in web header; `?tour=1` URL; `penny --tour` in CLI.
- **Summary bar:** Total drifts + severity breakdown; filter by severity chip.
- **Figma overlay:** Clickable bounding boxes from `frame.nodes` highlight active drift selectors.
- **Comparison cinema:** Animated Design vs Shipped swatches; spacing/typography rulers.
- **Voice coach:** Web Speech API TTS (`web/voice.js`); Listen button + tour auto-narrate.
- **Cross-panel sync:** Drift selection syncs Figma overlay, tokens, code, rendered preview, element chips.
- **Success state:** Full-width celebration when all drifts cleared.
- **CLI parity:** Summary screen before browse; live Claude when keyed; ASCII color swatches; `penny view --drift=N` deep-link.

### Web app (`web/server.js`, `web/app.jsx`, `web/index.html`, `web/voice.js`)

- Stdlib Node HTTP server on **`:5178`** — no frontend build step.
- React 18 + Tailwind via CDN (esm.sh + Play CDN; needs internet at view time).
- Reuses the full pipeline; SSE (`/api/events`) pushes live snapshots to all panels.

**Layout (left → right):**

| Left column | Right column |
|---|---|
| Figma embed iframe (live URL or seed PNG) | Problems slideshow (↑/↓) |
| Tokens JSON panel (click token → jump to drift) | Source code view with drift markers + inline diff |
| Rendered page preview (CSS HTML or JSX+Tailwind) with spotlight on flagged elements | Fix mode buttons |
| Page tabs (Homepage, Subscription, PricingCard.jsx) | File exclusion list |

**Fix modes (web):**
1. Apply this solution
2. Apply all
3. Ask your agent (clipboard)
4. Dismiss this suggestion / Restore dismissed
5. Revert page to original (when dirty)

**Scan modes (from config):**
- `ondemand` — rescan on POST `/api/scan` or after fix/revert.
- `watch` — `fs.watchFile` on each source (debounced 150ms); rescans on save.
- `interval` — timer rescans every N minutes; re-pulls live Figma if configured.
- `autonomous` — watch + auto-apply every fixable drift with no user input.

**API:** `/api/state`, `/api/scan`, `/api/fix`, `/api/revert`, `/api/exclude`, `/api/dismiss`, `/api/restore`.

**Other web behavior:**
- Seed pages write to `web/working_*.css|jsx` (committed seed stays pristine); real project sources write in place.
- File exclusion toggles persist to `~/.driftrc` and rebuild page set.
- Dismissed drifts persist across sessions.
- Design spec applied: Vercel-ish two-tone (#111 / #ede9df), solid colors only, no ambient animations, 150–250ms enter transitions, scrollbars hidden except in code blocks, no emojis in UI copy.

### Seed demo data (`seed/`)

- `figma-export.json` — design tokens (colors, spacing, typography).
- `frame.json` + `frame.svg` — offline Figma frame geometry.
- `deployed.css`, `subscription.css` — CSS pages with deliberate drifts.
- `home.html`, `subscription.html` — preview HTML for CSS pages.
- `PricingCard.jsx` — Tailwind/JSX page with splintered orange classes.
- `pages.json` — three demo sources wired by default.

Planted headline drift: **`brand/primary`** splintered into three near-identical oranges (`#ff6b35`, `#ff6a34`, `#f9683a`) → high-severity `inconsistent-usage`. Also: off-palette blue, off-scale `13px` spacing, hardcoded values.

### Tests (`npm test` — 25 passing)

- Pipeline: color normalization, perceptual clustering, Figma export parse, CSS location capture, all drift categories.
- Figma: live pull path, variables 403 tolerance, frame node flattening.
- Claude: live merge, offline fallback, offline skip.
- Fixer: fixability, plan diffs, apply + re-diff clears drift, selective apply + override.
- Parse: Tailwind arbitrary/scale/inline, comment filtering, JSX drift + Tailwind-preserving fixes, config round-trip.

---

## Tech stack

- **Runtime:** Node.js ESM (stdlib-first).
- **Deps:** `@anthropic-ai/sdk`, `postcss` only.
- **Figma:** REST API with personal access token (no OAuth).
- **Reasoning:** Claude Sonnet (`claude-sonnet-5`); offline explainer when no key.
- **UI:** Interactive terminal TUI + React web app (CDN, no build step).

## Explicit non-goals (unchanged)

- No auth flows, user accounts, or database.
- No real ML/classifier training.
- No handling every CSS edge case — colors, spacing, typography tokens only.
- Named Tailwind sizes (`text-lg`, `rounded-xl`) are advisory only, not auto-fixed.

## Commands

```bash
npm install

# Interactive CLI (onboards on first run if ~/.driftrc missing):
penny                     # browse problems (summary first with --tour)
penny --tour              # summary screen then browse
penny view                # launch web app -> http://localhost:5178
penny view --drift=0      # deep-link to drift index
penny init                # re-run onboarding
penny --css seed/deployed.css
penny --list-tokens

# Web app directly:
npm run web               # same as penny view (without auto-open browser)

# Tests:
npm test                  # 25 checks

# Live credentials (config or env):
#   FIGMA_TOKEN, FIGMA_FILE_KEY, FIGMA_FRAME_NODE, FIGMA_URL
#   ANTHROPIC_API_KEY
```

## Config file shape (`~/.driftrc`)

```json
{
  "figmaToken": "",
  "figmaFileKey": "",
  "figmaFrameNode": "",
  "figmaUrl": "",
  "anthropicKey": "",
  "agent": "Claude Code",
  "scanMode": "ondemand",
  "intervalMinutes": 5,
  "exclude": [],
  "sources": [],
  "dismissed": [],
  "uiMode": "tour",
  "voiceEnabled": true
}
```

Empty `sources` → bundled seed pages. Env vars override config at runtime.

## Source layout

```
src/
  cli.js       entry + routing (penny)
  config.js    ~/.driftrc load/save/onboard
  prompt.js    arrow-key select/input
  tui.js       interactive CLI browser
  figma.js     token + frame pull
  parse.js     CSS + markup dispatch
  css.js       postcss extractor
  color.js     normalization + perceptual distance
  diff.js      semantic drift detection
  claude.js    Sonnet reasoning + offline explainer
  fixer.js     plan + apply fixes
web/
  server.js    HTTP + SSE + scan modes
  app.jsx      React UI
  index.html   shell + design tokens
seed/          offline demo fixtures
test/          node:test suite
```

## Demo notes

- Zero-setup demo: `penny view?tour=1` or `penny --tour` — seed data + offline reasoning.
- Live Figma: set token + file key + frame node in onboarding or env.
- Live Claude: set `anthropicKey` in config or `ANTHROPIC_API_KEY`.
- Optimize for the 90-second stage demo. See [DEMO.md](../DEMO.md).

## Removed / superseded

- Static terminal drift report and `--html report.html` output — replaced by interactive TUI + web app.
- `--offline` CLI flag — offline reasoning is automatic when no API key is set.
- Old fix modes (auto / plan / accept-edits) — replaced by Apply this / Apply all / Ask your agent.
