# Demo Script — Penny (90 seconds)

**One-liner:** "Penny is an interactive drift coach for design engineers — it shows where Figma and code diverged, narrates why it matters, and walks you to a fix."

Run this first (offline, zero keys):

```
penny view
```

Then open **http://localhost:5178?tour=1** (or click **Guided tour** in the header).

## The 90 seconds

**0:00 — The problem (15s).**
"You ship UI from Figma. A week later the brand orange has splintered into three nearly identical hex codes — and nobody noticed until review."
Point at the **summary bar**: `13 drifts · 1 high · 5 medium · 7 low`.

**0:15 — See it (25s).** *(3-second-obvious moment.)*
Guided tour Step 2 — **Comparison cinema**: Design swatch vs Shipped swatch animate side by side.
Figma overlay highlights `.btn-primary`, `.badge`, `.hero-cta`.
> `[HIGH] inconsistent-usage · brand/primary`
> found: #ff6b35 · #ff6a34 · #f9683a

"One token, three oranges. Penny clusters by perceptual distance — not string diff."

**0:40 — Hear it (15s).**
Click **Listen**. Voice narrates why the drift matters and what to fix.
Optional: show off-palette blue and off-scale 13px on the next drift.

**0:55 — Fix and verify (20s).**
Click **Apply this solution** → tour advances to **Verify** → rescan → problem count drops.
"Design and code stay aligned — detect, understand, reconcile."

**1:15 — Close (10s).**
"Figma pull, semantic diff, comparison cinema, voice coach. CLI or web — same pipeline."

## CLI alternate path

```
penny --tour
```

Summary screen with severity counts → Enter to browse → same headline drift with ASCII color swatches.

## If asked

- **Live Figma / Claude?** Set keys in `penny init` or env. Both paths tested (`npm test`).
- **Dashboard vs tour?** Toggle in header; tour is for first-run and stage demo.
- **Voice?** Web Speech API in Chrome/Edge; respects reduced-motion (auto-speak off).

## Cut list

Don't open source files, don't explain redmean distance, don't apologize for offline mode.
