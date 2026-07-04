# Meridian — real-world test site for Penny

Polished SaaS pages with **intentional design-token drift** (brand splinters, off-scale spacing/type, off-palette accents). Use with a live Azure OpenAI key to test AI analysis.

## Try it

From the Penny repo root:

```bash
penny onboarding
```

Choose **Real test site — Meridian drift examples**, then run `penny view`.

No manual config — onboarding writes `projectRoot` and `sources` to `~/.driftrc` for you.

## Your own codebase

```bash
cd /path/to/your/project
penny onboarding
```

Choose **This folder — auto-detect CSS / JSX**. Penny walks the tree, pairs CSS with HTML, picks up JSX/Vue/Svelte, and saves the list automatically.

Optional: add a `penny.json` manifest in your project root to pin pages explicitly instead of auto-discovery.

## Page mix

| Page | Format | Preview kind |
|------|--------|----------------|
| Landing | CSS + HTML | Marketing homepage |
| Dashboard | CSS + HTML | App shell + metrics |
| Pricing | Tailwind JSX | Pricing tiers |
| Signup | React + Tailwind | Onboarding form |
| Settings | CSS + HTML | Account preferences |

## Expected token baseline (intrinsic)

- Brand primary `#ff6b35`, primary-dark `#e2542a`
- Text `#1a1a2e`, muted `#5b6472`
- Body 16px, heading 32px, caption 14px
- Spacing 8 / 16 / 24 / 32px, radius 8px

Drifts are embedded in production-looking UI — not labeled in the markup.
