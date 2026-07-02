---
version: alpha
name: B2B SaaS Starter
description: Quiet, system-typeface, neutral-on-blue chrome built on shadcn/ui. Production-grade defaults, not branded marketing.
colors:
  background: '#FCFCFC'
  foreground: '#424242'
  card: '#FFFFFF'
  card-foreground: '#424242'
  popover: '#FFFFFF'
  popover-foreground: '#424242'
  primary: '#3B82F6'
  primary-foreground: '#FFFFFF'
  secondary: '#F1F5F9'
  secondary-foreground: '#475569'
  muted: '#F8FAFC'
  muted-foreground: '#64748B'
  accent: '#E0F2FE'
  accent-foreground: '#1E40AF'
  destructive: '#EF4444'
  destructive-foreground: '#FFFFFF'
  border: '#E2E8F0'
  input: '#E2E8F0'
  ring: '#3B82F6'
dark:
  background: '#1E1E1E'
  foreground: '#E5E5E5'
  card: '#2D2D2D'
  card-foreground: '#E5E5E5'
  popover: '#2D2D2D'
  popover-foreground: '#E5E5E5'
  primary: '#3B82F6'
  primary-foreground: '#FFFFFF'
  secondary: '#2D2D2D'
  secondary-foreground: '#E5E5E5'
  muted: '#2D2D2D'
  muted-foreground: '#9CA3AF'
  accent: '#1E40AF'
  accent-foreground: '#C7DBFF'
  destructive: '#EF4444'
  destructive-foreground: '#FFFFFF'
  border: '#494949'
  input: '#494949'
  ring: '#3B82F6'
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

The B2B SaaS Starter is a production-leaning chrome — quiet, legible, system-typeface — built on shadcn/ui + Tailwind v4 with a single accent blue. It is a workspace UI for serious operators, not a marketing surface. The public Showcase Site shares the same shadcn token contract and primitives but commits harder to the brand: the `.marketing` scope (applied by `PublicLayout`) overrides the token values with a deep petrol teal + amber "signal" palette, and marketing `h1`/`h2` render in Archivo Variable drawn wide. One system, two registers.

**Emotional goals.** Calm, considered, inspectable. The interface should feel like a tool a team will use every day — closer to Linear or Vercel's dashboard than to a launch-day landing page. No exuberance, no novelty, no overlap with consumer-product aesthetics.

**Primary reference.** Stripe Dashboard, Linear, Vercel — sharp 0-radius surfaces, neutral grays, a single saturated blue for action affordance, and Geist throughout. Density is generous-but-not-airy.

**Anti-references.** Gradient hero pages, glassmorphism, neumorphism, glowing accents, illustration-heavy marketing surfaces. Any "consumer-y" warmth signals the brand wrong.

**Theme.** Neutral grays + a single saturated blue accent. Light by default, dark fully supported. Both themes share the same accent so the brand reads identically regardless of `prefers-color-scheme`. Authoritative token values live in OKLch in `apps/web/src/index.css` for perceptual uniformity; the sRGB hex tokens in this file are the portable equivalent for agents and exports.

## Colors

The palette is rooted in neutral grays with a single saturated blue accent — chosen so chrome stays out of the way and the data on screen reads first.

- **Background (`#FCFCFC` / `#1E1E1E`):** Page surface. Near-white in light mode, near-black in dark mode. Avoid hard `#FFF` / `#000`.
- **Card / Popover (`#FFFFFF` / `#2D2D2D`):** Lifted neutral surface for panels, dialogs, popovers, sidebars. Light mode card sits a hair above background; dark mode lifts visibly.
- **Foreground (`#424242` / `#E5E5E5`):** Body and heading text. Soft on light, soft on dark — true black/white reserved for accents.
- **Primary (`#3B82F6`):** The single accent. CTAs, focus rings, active links, selected rows. If everything is blue, nothing is.
- **Primary-foreground (`#FFFFFF`):** Pure white text on primary fills — passes contrast against the blue at all sizes.
- **Secondary (`#F1F5F9` / `#2D2D2D`):** Default button fill. Most buttons land here, not on primary.
- **Muted (`#F8FAFC` / `#2D2D2D`):** Recessed background for nested panels, code blocks, and "secondary information" zones.
- **Accent (`#E0F2FE` / `#1E40AF`):** Hover lift on rows and tabs. Light mode goes pale-cyan; dark mode goes saturated-blue. The accent-foreground tracks the inverse.
- **Border (`#E2E8F0` / `#494949`):** The carved edge that gives the card 0-radius chrome its shape. Always 1px. Never thicker.
- **Destructive (`#EF4444`):** Delete, revoke, leave-workspace. Confirmations only — never as a chrome color.
- **Ring (`#3B82F6`):** Focus outline. Same hue as primary so focus and action read as one system.
- **Chart 1–5:** Scaled-blue chart palette (no rainbow). Defined in `index.css` `--chart-1`…`--chart-5`; reach for these in dashboards before introducing new colors.

The sidebar has its own tokens (`--sidebar-*`) so navigation can lift independently from the body in either mode. Treat them as the source of truth for `WorkspaceShell` navigation chrome.

**Marketing scope.** Public routes (wrapped in `.marketing` by `PublicLayout`) redefine the same token names in `apps/web/src/index.css`: primary becomes a deep petrol teal (`oklch(0.42 0.075 215)` light / lifted teal dark), neutrals tint toward the same hue, and two extra tokens exist — `--signal` (burnt amber, for schematic marks and status dots) and `--signal-ink` (its text-safe counterpart, ≥4.5:1 on the page background). `.band-deep` re-overrides the contract for petrol-drenched sections; inside a band, `primary` flips to amber so CTAs pop. Workspace routes never see any of this — the app keeps the neutral/blue chrome above.

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

There is also a display face for the public surface: **Archivo Variable** (`--font-display`), applied by `index.css` to `.marketing h1/h2` at `font-stretch: 118%` — industrial signage lettering for showcase headlines. It never runs inside the workspace shell, and it never runs as body copy.

**Rules.** Geist runs everything except code and marketing display headings. Geist Mono never runs as prose. Avoid uppercase labels — the brand is sentence-case.

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

- **`button-primary`** is the saturated blue CTA. One per screen region. Reserve for the most important action ("Save", "Create workspace", "Sign in").
- **`button-secondary`** is the default action. The overwhelming majority of buttons are this.
- **`button-ghost`** carries no fill and no border — use for in-row actions, dismiss, cancel.
- **`button-destructive`** is for delete, revoke, leave-workspace. Always paired with a confirmation step.
- **`card`** is the only panel surface. Don't nest cards inside cards; lift via `bg-muted` instead.
- **`input`** sits at `border` + `bg-card`. Focus ring is the primary blue.
- **`badge`** uses 22px height + 4/8px padding. Plan-tier and status pills should land here, not in ad-hoc spans.
- **Sidebar** uses its own `--sidebar-*` tokens — don't apply body tokens to navigation chrome.

## Do's and Don'ts

**Do**

- Use neutral grays for chrome and reserve `primary` for one action affordance per region.
- Lean on shadcn/ui primitives — they already consume these tokens.
- Use `mono` for any user-facing identifier: workspace slugs, API tokens, request IDs, timestamps in tables.
- Keep panels flat. Color lift + a 1px border is enough elevation.
- Honor `prefers-color-scheme`. Dark mode is not an afterthought; both themes ship the same content.

**Don't**

- Don't introduce a second accent hue in the workspace. The one blue is the app system; petrol + amber belong to the `.marketing` scope only.
- Don't swap in system fonts "for performance." Geist + Geist Mono (+ Archivo Variable on public routes) are load-bearing and shipped self-hosted via `@fontsource-variable`.
- Don't round panels. The sharp/soft contrast between cards and controls is the brand.
- Don't use `destructive` red for anything but genuinely destructive actions. It is a signal, not a color.
- Don't reuse the chart palette for chrome — those hues exist to differentiate data series, not UI.
- Don't add gradient fills, neon glows, or glassmorphism. The brand is restraint.
- Don't uppercase labels or buttons. Sentence-case throughout.
- Don't ship marketing-only chrome on workspace routes (or vice versa). One palette, one type system, end-to-end.
