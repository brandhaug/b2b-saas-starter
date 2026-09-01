---
version: alpha
name: B2B SaaS Starter
description: Quiet, system-typeface, neutral-on-mauve chrome built on shadcn/ui. Production-grade defaults, not branded marketing.
colors:
  background: '#eff1f5'
  foreground: '#4c4f69'
  card: '#e6e9ef'
  card-foreground: '#4c4f69'
  popover: '#e6e9ef'
  popover-foreground: '#4c4f69'
  primary: '#8839ef'
  primary-foreground: '#ffffff'
  secondary: '#ccd0da'
  secondary-foreground: '#4c4f69'
  muted: '#e6e9ef'
  muted-foreground: '#5c5f77'
  accent: '#bcc0cc'
  accent-foreground: '#4c4f69'
  destructive: '#d20f39'
  destructive-foreground: '#ffffff'
  border: '#ccd0da'
  input: '#ccd0da'
  ring: '#7287fd'
dark:
  background: '#1e1e2e'
  foreground: '#cdd6f4'
  card: '#181825'
  card-foreground: '#cdd6f4'
  popover: '#181825'
  popover-foreground: '#cdd6f4'
  primary: '#cba6f7'
  primary-foreground: '#11111b'
  secondary: '#313244'
  secondary-foreground: '#cdd6f4'
  muted: '#313244'
  muted-foreground: '#a6adc8'
  accent: '#45475a'
  accent-foreground: '#cdd6f4'
  destructive: '#f38ba8'
  destructive-foreground: '#11111b'
  border: '#313244'
  input: '#45475a'
  ring: '#b4befe'
typography:
  display:
    fontFamily: Geist Variable
    fontSize: 3rem
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.02em
  h1:
    fontFamily: Geist Variable
    fontSize: 2.25rem
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.015em
  h2:
    fontFamily: Geist Variable
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.01em
  h3:
    fontFamily: Geist Variable
    fontSize: 1.25rem
    fontWeight: 600
    lineHeight: 1.25
  body-lg:
    fontFamily: Geist Variable
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.6
  body-md:
    fontFamily: Geist Variable
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: Geist Variable
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Geist Variable
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.2
  mono:
    fontFamily: Geist Mono Variable
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "'tnum'"
rounded:
  none: 0px
  sm: 4px
  md: 6px
  lg: 8px
  interactive: 6px
  pill: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  3xl: 72px
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.interactive}'
    padding: 12px
    height: 36px
  button-secondary:
    backgroundColor: '{colors.secondary}'
    textColor: '{colors.secondary-foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.interactive}'
    padding: 12px
    height: 36px
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.interactive}'
    padding: 12px
    height: 36px
  button-destructive:
    backgroundColor: '{colors.destructive}'
    textColor: '{colors.destructive-foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.interactive}'
    padding: 12px
    height: 36px
  card:
    backgroundColor: '{colors.card}'
    textColor: '{colors.card-foreground}'
    rounded: '{rounded.lg}'
    border: '{colors.border}'
    padding: 24px
  input:
    backgroundColor: '{colors.card}'
    textColor: '{colors.foreground}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.interactive}'
    border: '{colors.input}'
    height: 36px
    padding: 12px
  badge:
    typography: '{typography.label}'
    rounded: '{rounded.interactive}'
    padding: '4px 8px'
    height: 22px
---

## Overview

The B2B SaaS Starter is a production-leaning chrome — quiet, legible, system-typeface — built on shadcn/ui + Tailwind v4 with a single saturated mauve accent. It is a workspace UI for serious operators, not a marketing surface. The public Showcase Site shares the same shadcn token contract, the same Catppuccin Mocha values, and the same primitives; it separates itself through type and rhythm rather than hue — marketing `h1`/`h2` render in Fraunces, a high-contrast display serif, and `.band-deep` sinks whole sections to Catppuccin crust. One system, one palette, two registers.

**Emotional goals.** Calm, considered, inspectable. The interface should feel like a tool a team will use every day — closer to Linear or Vercel's dashboard than to a launch-day landing page. No exuberance, no novelty, no overlap with consumer-product aesthetics.

**Primary reference.** Stripe Dashboard, Linear, Vercel — sharp 0-radius surfaces, Catppuccin neutrals, a single saturated mauve for action affordance, and Geist throughout. Density is generous-but-not-airy.

**Anti-references.** Gradient hero pages, glassmorphism, neumorphism, glowing accents, illustration-heavy marketing surfaces. Any "consumer-y" warmth signals the brand wrong.

**Theme.** Catppuccin Mocha, everywhere, always. There is one scheme: `<html>` carries a hardcoded `dark` class, `prefers-color-scheme` is not consulted, and there is no theme toggle. Authoritative token values live in OKLch in `apps/web/src/index.css` for perceptual uniformity; the sRGB hex tokens in this file are the portable equivalent for agents and exports.

## Colors

The palette is Catppuccin Mocha with a single saturated mauve accent (#CBA6F7) — chosen so chrome stays out of the way and the data on screen reads first. One value per token; there is no light-mode counterpart.

- **Background (`#1E1E2E`, mocha base):** Page surface. Near-black, never hard `#000`.
- **Card / Popover (`#181825`, mocha mantle):** Panels, dialogs, popovers, sidebars. Sits _below_ the background rather than above it — depth reads as recession here, not elevation.
- **Foreground (`#CDD6F4`, mocha text):** Body and heading text. Soft, never pure white.
- **Primary (`#CBA6F7`, mocha mauve):** The single accent. CTAs, active links, selected rows. If everything is mauve, nothing is.
- **Primary-foreground (`#11111B`, mocha crust):** Near-black on the lifted mauve fill; passes contrast at all sizes.
- **Secondary (`#313244`, mocha surface0):** Default button fill. Most buttons land here, not on primary.
- **Muted (`#313244`, mocha surface0):** Recessed background for nested panels, code blocks, and "secondary information" zones.
- **Accent (`#45475A`, mocha surface1):** Hover lift on rows and tabs.
- **Border (`#313244`, mocha surface0):** The carved edge that gives the card 0-radius chrome its shape. Always 1px. Never thicker.
- **Destructive (`#F38BA8`, mocha red):** Delete, revoke, leave-workspace. Confirmations only — never as a chrome color.
- **Ring (`#B4BEFE`, mocha lavender):** Focus outline. Same hue family as primary so focus and action read as one system.
- **Chart 1–5:** Scaled chart palette in the brand hue family (no rainbow). Defined in `index.css` `--chart-1`…`--chart-5`; reach for these in dashboards before introducing new colors.

The sidebar has its own tokens (`--sidebar-*`) so navigation can separate from the body independently. Treat them as the source of truth for `WorkspaceShell` navigation chrome.

**Marketing scope.** Public routes are wrapped in `.marketing` by `PublicLayout`, but that scope no longer redefines a single color token — the showcase and the app share one palette. What `.marketing` still owns is typography (Fraunces on `h1`/`h2`), balanced heading rag, a guaranteed focus ring on bare `<a>`/`<button>` CTAs, and the prose token map for long-form MDX. Two extra tokens exist site-wide: `--signal` (mocha peach `#FAB387`, for schematic marks and status dots) and `--signal-ink`, its text-safe counterpart — the same value now that every surface is dark, kept as two names so call sites are unchanged. `.band-deep` sinks a section to mocha crust (`#11111B`) and flips `primary` to peach so CTAs pop against the drench.

## Typography

Two variable system-grade fonts, both shipped via `@fontsource-variable`.

- **Geist Variable** — body and headings. Vercel's modern grotesque. Used for everything readable.
- **Geist Mono Variable** — code blocks, API tokens, numeric IDs, terminal-flavored UI. Tabular figures (`'tnum'`) are on by default.

**Hierarchy.**

- `display` (3rem / Geist 600 / -0.02em tracking) — marketing hero only. Never inside the workspace shell.
- `h1`–`h3` (Geist 600) — page and panel titles. Negative tracking tightens to compensate for Geist's open spacing at large sizes.
- `body-lg` / `body-md` / `body-sm` (Geist 400) — prose, docs, blog, descriptions. `body-md` (15px) is the workspace-default; docs use `body-lg` (18px) for long reads.
- `label` (Geist 500) — buttons, tabs, form labels, badge text. Not uppercase. Tracking neutral.
- `mono` (Geist Mono, tabular figures) — IDs, tokens, code, numbers in tables. `font-feature: 'tnum'` is non-negotiable for any digit that updates.

There is also a display face for the public surface: **Fraunces Variable** (`--font-display`), applied by `index.css` to `.marketing h1/h2` with `font-variation-settings: 'opsz' 120` — a high-contrast serif with flared serifs and a sharp thin/thick modulation, pinned to the optical size where it reads as display lettering rather than book text. The serif against Geist body copy is the showcase's whole register shift now that the palette is shared. It never runs inside the workspace shell, and it never runs as body copy.

**Rules.** Geist runs everything except code and marketing display headings; the display serif runs only there. Geist Mono never runs as prose. Avoid uppercase labels — the brand is sentence-case.

## Layout

**Content first, chrome second.** The shell is deliberately minimal: a thin top bar, a left sidebar in the workspace, and a wide main content region. Marketing routes drop the sidebar but keep the same top bar.

**Spacing scale.** The 4 → 72px scale (`xs` → `3xl`) is the only vocabulary. Tailwind's `--spacing: 0.25rem` base means `gap-4` / `p-4` / `m-4` produce 16px (`md`). Use named tokens via Tailwind utilities, never one-off pixel values.

**Container widths.** Public routes cap at `max-w-7xl` (1280px). Long-form docs/blog cap at `max-w-3xl` (768px) for readability. Workspace shells fill viewport width minus the sidebar.

**Sticky chrome.** The top bar is `sticky top-0` with `bg-background/90 backdrop-blur`. The sidebar is fixed-width on desktop, sheet-overlay on mobile.

**Touch targets.** Interactive elements use `touch-action: manipulation` to suppress mobile tap delay. Buttons and links honor a 36px minimum height.

## Elevation & Depth

Elevation is communicated through color lift (`background` → `card` → `popover`) and a 1px `border` stroke, with restrained shadows on float-only surfaces. Three tiers:

1. **Flat (`background`).** The page surface. Docs prose, marketing copy.
2. **Panel (`card`).** Workspace panels, dashboard cards, dialog bodies. Always sits on flat with a `border` outline. No shadow.
3. **Float (`popover`).** Dropdowns, tooltips, command palette. Same color as `card` but with `shadow-md` and a `border` outline.

Backdrop blur is reserved for the top bar (`bg-background/90 backdrop-blur`) and for `Sheet` / `Dialog` overlays. Never apply blur to permanent chrome surfaces.

## Shapes

**Square by default.** `--radius` is `0rem`. Cards, panels, and dialogs render with hard 90° corners — the tabletop-flat shadcn aesthetic. Buttons and inputs pick up `rounded-md` (6px) to soften the focusable affordance, but the surrounding chrome stays sharp.

This is intentional: the contrast between sharp panels and softly-rounded controls is the brand. Don't round panels to match the buttons.

**No clipping ornaments.** No diagonal notches, no folded-corner cards, no SVG-shaped buttons. Shape is communicated by `border` + `rounded`.

## Components

Component tokens are defined in the YAML above and are the normative surface for agents. A few usage notes:

- **`button-primary`** is the saturated mauve CTA. One per screen region. Reserve for the most important action ("Save", "Create workspace", "Sign in").
- **`button-secondary`** is the default action. The overwhelming majority of buttons are this.
- **`button-ghost`** carries no fill and no border — use for in-row actions, dismiss, cancel.
- **`button-destructive`** is for delete, revoke, leave-workspace. Always paired with a confirmation step.
- **`card`** is the only panel surface. Don't nest cards inside cards; lift via `bg-muted` instead.
- **`input`** sits at `border` + `bg-card`. Focus ring is the primary accent.
- **`badge`** uses 22px height + 4/8px padding. Plan-tier and status pills should land here, not in ad-hoc spans.
- **Sidebar** uses its own `--sidebar-*` tokens — don't apply body tokens to navigation chrome.

## Do's and Don'ts

**Do**

- Use neutral grays for chrome and reserve `primary` for one action affordance per region.
- Lean on shadcn/ui primitives — they already consume these tokens.
- Use `mono` for any user-facing identifier: workspace slugs, API tokens, request IDs, timestamps in tables.
- Keep panels flat. Color lift + a 1px border is enough elevation.
- Check contrast against the mocha surfaces specifically. There is one scheme, so there is one set of numbers to hit — no excuse for a token that only passes in the other mode.

**Don't**

- Don't introduce a second accent hue. Mauve is the accent; peach (`--signal`) is reserved for schematic marks, status dots, and `.band-deep` CTAs.
- Don't add a light-mode branch, a `prefers-color-scheme` query, or a theme toggle. Catppuccin Mocha is the only scheme, and a second one would double every contrast check.
- Don't swap in system fonts "for performance." Geist + Geist Mono (+ Fraunces Variable on public routes) are shipped self-hosted via `@fontsource-variable` and each carries a distinct job.
- Don't round panels. The sharp/soft contrast between cards and controls is the brand.
- Don't use `destructive` red for anything but genuinely destructive actions. It is a signal, not a color.
- Don't reuse the chart palette for chrome — those hues exist to differentiate data series, not UI.
- Don't add gradient fills, neon glows, or glassmorphism. The brand is restraint.
- Don't uppercase labels or buttons. Sentence-case throughout.
- Don't ship marketing-only chrome on workspace routes (or vice versa). One palette, one type system, end-to-end.
