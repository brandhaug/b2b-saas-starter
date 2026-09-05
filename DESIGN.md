---
version: alpha
name: B2B SaaS Starter
description: Sharp-panel, single-scheme (Catppuccin Mocha) chrome on shadcn/ui — mauve action accent, editorial display voice (Newsreader) on the landing page only. Production-grade defaults, not branded marketing.
colors:
  background: '#1e1e2e'       # mocha base
  foreground: '#cdd6f4'       # mocha text
  card: '#181825'             # mocha mantle
  card-foreground: '#cdd6f4'
  popover: '#181825'
  popover-foreground: '#cdd6f4'
  primary: '#cba6f7'          # mocha mauve — the single accent
  primary-foreground: '#11111b' # mocha crust
  secondary: '#313244'        # mocha surface0
  secondary-foreground: '#cdd6f4'
  muted: '#313244'
  muted-foreground: '#a6adc8' # mocha subtext0
  accent: '#45475a'           # mocha surface1
  accent-foreground: '#cdd6f4'
  destructive: '#f38ba8'      # mocha red
  destructive-foreground: '#11111b'
  border: '#313244'
  input: '#6c7086'            # mocha overlay0 — control edge; clears 3:1 non-text contrast on every surface (3.36:1 on background, 3.59:1 on card)
  ring: '#b4befe'             # mocha lavender
  signal: '#fab387'           # mocha peach — schematic marks, status dots, .band-deep CTAs
  signal-ink: '#fab387'       # same value; the text-safe name is kept so call sites never change
  overlay: '#11111b'          # mocha crust — dialog/sheet/menu/command scrim, rendered at /80
status:
  ok: '#a6e3a1'               # mocha green — delivered, active, enabled
  warn: '#f9e2af'             # mocha yellow — pending, needs attention
  info: '#89b4fa'             # mocha blue — unread, informational
chart:
  chart-1: '#89b4fa'
  chart-2: '#a6e3a1'
  chart-3: '#f9e2af'
  chart-4: '#fab387'
  chart-5: '#cba6f7'
sidebar:
  sidebar: '#181825'
  sidebar-foreground: '#cdd6f4'
  sidebar-primary: '#cba6f7'
  sidebar-primary-foreground: '#11111b'
  sidebar-accent: '#45475a'
  sidebar-accent-foreground: '#cdd6f4'
  sidebar-border: '#313244'
  sidebar-ring: '#b4befe'
typography:
  display:
    fontFamily: Newsreader Variable
    fontVariation: 'opsz 72'
    fontSize: 3.75rem max (Tailwind text-6xl)
    fontWeight: 600
    lineHeight: 1.0-1.15
    letterSpacing: 0 (the display cut sets its own tight fit; opsz pinned at 72)
    scope: the landing page only — its hero h1 and section h2s, via the `font-display` utility. Every other route (docs, blog, FAQ, legal, auth, workspace) is Geist throughout; never the workspace shell, never card or panel titles, never below 24px
  h1:
    fontFamily: Geist Variable — sans on every route; the serif never leaves the landing page
    fontSize: 1.875rem (text-3xl) — the shell's page title is text-xl
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.01em
  h2:
    fontFamily: Geist Variable (landing section h2s alone run Newsreader at text-3xl/4xl)
    fontSize: 1.25rem (text-xl) in docs prose via `prose-h2`, or 1.125rem (text-lg, CardTitle)
    fontWeight: 600
  h3:
    fontFamily: Geist Variable
    fontSize: 0.875-1rem (text-sm…text-base)
    fontWeight: 600
  body-lg:
    fontFamily: Geist Variable
    fontSize: 1.125rem (text-lg)
    fontWeight: 400
    lineHeight: 1.6
  body-md:
    fontFamily: Geist Variable
    fontSize: 0.9375rem (text-base @ mobile / text-sm @ md)
    fontWeight: 400
    lineHeight: 1.5-1.625
  body-sm:
    fontFamily: Geist Variable
    fontSize: 0.875rem (text-sm)
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Geist Variable
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.0 (leading-none; wrapped FieldLabel copy uses leading-snug)
  mono:
    fontFamily: Geist Mono Variable
    fontSize: 0.75rem-0.875rem
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "'tnum'"
  micro:
    # Chrome lettering only — keyboard hints, dense table headers, schematic
    # labels. Never prose, never interactive labels.
    text-2xs: 0.6875rem
    text-3xs: 0.625rem
    text-4xs: 0.5rem
radius:
  root: 0.5rem (the shadcn base; sm/md derive from it by calc)
  sm: 4px (calc)
  md: 6px (controls: rounded-md — buttons, inputs, selects, menus, toasts)
  lg: 0rem (pinned by hand in index.css — large surfaces stay square)
  xl: 0rem (pinned by hand in index.css — large surfaces stay square)
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
    rounded: '{radius.interactive}'
    height: 36px (default) / 44px (lg)
  button-outline:
    backgroundColor: '{colors.input}/30'
    borderColor: '{colors.input}'
    textColor: '{colors.foreground}'
    typography: '{typography.label}'
    rounded: '{radius.interactive}'
    height: 36px (default) / 44px (lg)
  # Size inventory: default|icon 36px, xs|icon-xs 32px (in-menu/in-row chrome
  # only), lg|icon-lg 44px. There is no `sm`/`icon-sm` — 36px is the only
  # mid size. Every control renders 44px tall below `md` (max-md:h-11 /
  # max-md:size-11) for touch.
  button-secondary:
    backgroundColor: '{colors.secondary}'
    textColor: '{colors.secondary-foreground}'
    typography: '{typography.label}'
    rounded: '{radius.interactive}'
    height: 36px
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.foreground}'
    typography: '{typography.label}'
    rounded: '{radius.interactive}'
    height: 36px (the dense `xs` is 32px and is reserved for in-menu/in-row chrome)
  button-destructive:
    backgroundColor: '{colors.destructive}/20'
    textColor: '{colors.destructive}'
    typography: '{typography.label}'
    rounded: '{radius.interactive}'
    height: 36px
  card:
    backgroundColor: '{colors.card}'
    textColor: '{colors.card-foreground}'
    rounded: 0px
    border: 1px '{colors.border}' (ring)
    padding: 16-24px
  input:
    backgroundColor: '{colors.input}/30'
    textColor: '{colors.foreground}'
    typography: '{typography.body-sm} (text-base below md — iOS Safari zooms a 14px input)'
    rounded: '{radius.interactive}'
    border: '{colors.input}'
    height: 36px
  badge:
    typography: 0.75rem / 500 (text-xs font-medium — pill density, deliberately not the label ramp)
    rounded: '{radius.interactive}'
    height: 22px
  status-badge:
    variants: ok | warn | info | neutral | outline | destructive — ok/warn/info from `status.*`, `outline` for unknown or free-text fallbacks, `destructive` for refusal; mauve `default` means current/selected only
    mapping: single-sourced in `apps/web/src/lib/badge-variants.ts` (status → variant, plus a roleVariant); call sites never pick ad-hoc variants
---

## Overview

The B2B SaaS Starter is a production-leaning chrome — quiet, legible, sharp — built on shadcn/ui + Tailwind v4 with a single saturated mauve accent. It is a workspace UI for serious operators, not a marketing surface. The public Showcase Site shares the same shadcn token contract, the same Catppuccin Mocha values, and the same primitives; it separates itself through type and rhythm rather than hue — the landing page's hero and section headings render in Newsreader, an editorial display serif (the one place the serif runs), and `.band-deep` sinks whole sections to Catppuccin crust. One system, one palette, two registers.

**Emotional goals.** Calm, considered, inspectable. The interface should feel like a tool a team will use every day — closer to Linear or Vercel's dashboard than to a launch-day landing page. No exuberance, no novelty, no overlap with consumer-product aesthetics.

**Primary reference.** Stripe Dashboard, Linear, Vercel — sharp 0-radius surfaces, Catppuccin neutrals, a single saturated mauve for action affordance, and Geist throughout.

**Anti-references.** Gradient hero pages, glassmorphism, neumorphism, glowing accents, illustration-heavy marketing surfaces. Any "consumer-y" warmth signals the brand wrong.

**Theme.** Catppuccin Mocha, everywhere, always. There is one scheme: `:root` carries it directly — the `dark` class and the `dark:` custom variant no longer exist (`starter/no-dark-prefix` fails the build on any use), `prefers-color-scheme` is not consulted, and there is no theme toggle. Authoritative token values live in OKLch in `apps/web/src/index.css` for perceptual uniformity; the sRGB hex tokens in this file are the portable equivalent for agents and exports.

## Colors

The palette is Catppuccin Mocha with a single saturated mauve accent (#CBA6F7) — chosen so chrome stays out of the way and the data on screen reads first. One value per token; there is no light-mode counterpart.

- **Background (`#1E1E2E`, mocha base):** Page surface. Near-black, never hard `#000`.
- **Card / Popover (`#181825`, mocha mantle):** Panels, dialogs, popovers, sidebars. Sits _below_ the background rather than above it — depth reads as recession here, not elevation.
- **Foreground (`#CDD6F4`, mocha text):** Body and heading text. Soft, never pure white.
- **Primary (`#CBA6F7`, mocha mauve):** The single accent. CTAs, active links, selected rows. If everything is mauve, nothing is.
- **Primary-foreground (`#11111B`, mocha crust):** Near-black on the lifted mauve fill; passes contrast at all sizes.
- **Secondary (`#313244`, mocha surface0):** The solid neutral button fill — for actions that need more presence than outline without competing with primary (alternative auth paths, standalone neutral CTAs).
- **Muted (`#313244`, mocha surface0):** Recessed background for nested panels, code blocks, and "secondary information" zones.
- **Accent (`#45475A`, mocha surface1):** Hover lift on rows and tabs.
- **Border (`#313244`, mocha surface0):** The carved edge that gives the card 0-radius chrome its shape. Always 1px. Never thicker.
- **Input (`#6C7086`, mocha overlay0):** Control edge and the `bg-input/30` fill. It is deliberately lighter than `border` so a 1px control edge clears 3:1 non-text contrast on every surface a control sits on — 3.36:1 on background, 3.59:1 on card (surface1 managed 1.80:1).
- **Destructive (`#F38BA8`, mocha red):** Delete, revoke, leave-workspace. Confirmations only — never as a chrome color.
- **Ring (`#B4BEFE`, mocha lavender):** Focus indicator: a 2px full-opacity ring with a 2px offset, on every interactive control and on bare marketing `<a>`/`<button>` CTAs. Same hue family as primary so focus and action read as one system.
- **Overlay (`#11111B`, mocha crust):** Scrim token for dialog, sheet, menu, and command-palette backdrops, rendered at `/80` — crust at high alpha reads as a dimming layer on this scheme, where a plain black scrim was invisible.
- **Status (`--status-ok/warn/info`):** Green, yellow, blue — one hue per state, shared by badges, alerts, dots, and toasts. `ok` is delivered/active/enabled, `warn` is pending/needs-attention, `info` is unread/informational. Chart hues keep their own names; status colors are chrome, chart colors are data series.
- **Chart 1–5:** Scaled chart palette in the brand hue family (no rainbow). Defined in `index.css` `--chart-1`…`--chart-5`; reach for these in dashboards before introducing new colors.

The sidebar has its own tokens (`--sidebar-*`) so navigation can separate from the body independently. They are the source of truth for `WorkspaceShell` navigation chrome — don't apply body tokens to it.

**Marketing scope.** Public routes are wrapped in `.marketing` by `PublicLayout`, but that scope redefines no color token — the showcase and the app share one palette. What `.marketing` still owns is typography scoping (balanced heading rag, guaranteed focus ring on bare `<a>`/`<button>` CTAs, and the prose token map for long-form MDX) plus `.band-deep`, which sinks a section to mocha crust (`#11111B`) and flips `primary` to peach so CTAs pop against the drench.

## Typography

Two variable system-grade faces and one display face, all shipped self-hosted via `@fontsource-variable` (family names are `'Geist Variable'`, `'Geist Mono Variable'`, `'Newsreader Variable'` — the un-suffixed names match no `@font-face` and silently fall back).

- **Geist Variable** — body and headings. Vercel's modern grotesque. Used for everything readable.
- **Geist Mono Variable** — code blocks, API tokens, numeric IDs, terminal-flavored UI. Tabular figures (`'tnum'`) are on by default.
- **Newsreader Variable** (`--font-display`) — the landing page's display voice, applied per-heading via the `font-display` utility (`@utility` in `index.css`) with `font-variation-settings: 'opsz' 72` pinned (its maximum optical size) where its display cut's stroke contrast reads as display lettering rather than text face. It runs on the landing hero `h1` and landing section `h2`s only — every other route, public or workspace, is Geist throughout. Never inside the workspace shell, never on card or panel titles, never below 24px, where a serif at small sizes reads as a caption.

**Hierarchy.** The Tailwind steps in use:

- Landing hero: `text-5xl`/`text-6xl` Newsreader 600, zero tracking; landing section `h2`s run `text-3xl`/`text-4xl` Newsreader 600.
- Page `h1`: every non-landing route — docs, blog, FAQ, legal, auth — renders Geist `text-3xl font-semibold`; the workspace shell's page title is `text-xl`.
- Docs/blog article prose: `prose-lg` with `prose-h2:text-xl`, `prose-h3:text-base` — article sections stay clearly below the page `h1`.
- Panel/card titles (`CardTitle`): `text-lg` Geist 600 — a real heading, never 12–14px.
- `h3`/labels: `text-sm`–`text-base`, Geist 500–600.
- Body: `text-base` below `md` (inputs render 16px so iOS Safari never zooms on focus), `text-sm` from `md` up. `text-lg` for long-form docs prose.
- Micro (`text-2xs`/`text-3xs`/`text-4xs`): mono chrome lettering only — keyboard hints, dense table headers, schematic labels. Never prose, never interactive labels.

**Rules.** Geist runs everything except code and the landing display headings; the display serif runs only there. Geist Mono never runs as prose. Avoid uppercase labels — the brand is sentence-case.

## Layout

**Content first, chrome second.** The shell is deliberately minimal: a thin top bar, a left sidebar in the workspace, and a wide main content region. Marketing routes drop the sidebar but keep the same top bar.

**Spacing scale.** The 4 → 72px scale (`xs` → `3xl`) is the only vocabulary. Tailwind's `--spacing: 0.25rem` base means `gap-4` / `p-4` / `m-4` produce 16px (`md`). Use named tokens via Tailwind utilities, never one-off pixel values. Sticky chrome offsets the shared 64px header with one step of clearance (`top-18`); anchor `scroll-margin-top` is `5.5rem`.

**Container widths.** Public routes cap at `max-w-7xl` (1280px). Long-form docs/blog cap at `max-w-3xl` (768px) for readability. Workspace shells center the page body at `max-w-4xl` (896px) — one column for every workspace page; the `PageHeader` + `Panel` anatomy (`apps/web` intent node) assumes it.

**Sticky chrome.** The top bar is `sticky top-0`. The sidebar is fixed-width on desktop, sheet-overlay on mobile.

**Touch targets.** Interactive elements use `touch-action: manipulation` to suppress mobile tap delay. Buttons honor a 36px desktop minimum (`default`/`icon`; `lg`/`icon-lg` are 44px); the dense `xs`/`icon-xs` (32px) is reserved for in-menu and in-row chrome. Below `md` every control renders 44px tall (`max-md:h-11` / `max-md:size-11`).

## Elevation & Depth

Elevation is communicated through color lift (`background` → `card` → `popover`) and a 1px `border` stroke, with restrained shadows on float-only surfaces. Three tiers:

1. **Flat (`background`).** The page surface. Docs prose, marketing copy.
2. **Panel (`card`).** Workspace panels, dashboard cards, dialog bodies. Always sits on flat with a `border` outline. No shadow.
3. **Float (`popover`).** Dropdowns, tooltips, command palette. Same color as `card` but with `shadow-md` and a `border` outline.

Backdrop blur is reserved for overlays (`Sheet` / `Dialog`). Never apply blur to permanent chrome surfaces.

## Shapes

**Square by default.** `--radius` is `0.5rem` (the shadcn base that `--radius-sm`/`--radius-md` derive from), but `--radius-lg` and `--radius-xl` are pinned to `0rem` by hand in `index.css`, so cards, panels, and dialogs render with hard 90° corners — the tabletop-flat shadcn aesthetic. Buttons, inputs, menus, and toasts pick up `rounded-md` (6px, `--radius-md`) to soften the focusable affordance, but the surrounding chrome stays sharp.

This is intentional: the contrast between sharp panels and softly-rounded controls is the brand. Don't round panels to match the buttons.

**No clipping ornaments.** No diagonal notches, no folded-corner cards, no SVG-shaped buttons. Shape is communicated by `border` + `rounded`.

## Components

Component tokens are defined in the YAML above and are the normative surface for agents. A few usage notes:

- **`button-primary`** is the saturated mauve CTA. One per screen region. Reserve for the most important action ("Save", "Create workspace", "Sign in").
- **`button-outline`** is the default action. The majority of buttons land here: a bordered `bg-input/30` control that reads as clickable without adding visual weight.
- **`button-secondary`** is the solid neutral fill — reach for it when an action needs more presence than outline but must not compete with the primary (alternative auth paths beside "Sign in", standalone "go" links).
- **`button-ghost`** carries no fill and no border — use for in-row actions, dismiss, cancel.
- **`button-destructive`** is for delete, revoke, leave-workspace. Always paired with a confirmation step.
- **`alert`** never renders as a plain card. `destructive` is a tinted fill (`bg-destructive/10` + `border-destructive/40`) with a mandatory icon; `ok` mirrors it from the status token (`bg-status-ok/10` + `border-status-ok/40`).
- **`card`** is the only panel surface — `bg-card` on `border-border`, always sharp-cornered. Don't nest cards inside cards; lift via `bg-muted` instead.
- **`input`** sits at `border-input` + `bg-input/30`. Focus is a 2px full-opacity `--ring` with a 2px offset.
- **`badge`** uses 22px height + status variants (`ok`/`warn`/`info`/`neutral`) for states, `outline` for unknown or free-text statuses, `destructive` for refusal; mauve `default` means current or selected, never a status. The status→variant mapping (plus `roleVariant`) is single-sourced in `apps/web/src/lib/badge-variants.ts` — pills land there, not in ad-hoc spans.
- **Code blocks** in docs/blog MDX highlight with Shiki `catppuccin-mocha`, with the `pre` background pinned to `--card` so blocks keep the panel treatment. Mermaid diagrams run theme `base` with `themeVariables` mirroring these tokens.
- **Sidebar** uses its own `--sidebar-*` tokens — don't apply body tokens to navigation chrome.

## Do's and Don'ts

**Do**

- Use neutral grays for chrome and reserve `primary` for one action affordance per region.
- Lean on shadcn/ui primitives — they already consume these tokens.
- Use `mono` for any user-facing identifier: workspace slugs, API tokens, request IDs, timestamps in tables.
- Keep panels flat. Color lift + a 1px border is enough elevation.
- Check contrast against the mocha surfaces specifically. There is one scheme, so there is one set of numbers to hit — no excuse for a token that only passes in the other mode.
- State colors with tokens: `var(--chart-1…5)` for data series, semantic classes for chrome. Raw hex lives only in `apps/web/src/index.css` (the root document's theme-color meta aside) — two lint rules (`starter/no-dark-prefix`, `starter/no-hex-color`) hold this line.

**Don't**

- Don't introduce a second accent hue. Mauve is the accent; peach (`--signal`) is reserved for schematic marks, status dots, and `.band-deep` CTAs. Statuses use the `--status-*` trio, not new hues.
- Don't add a light-mode branch, a `prefers-color-scheme` query, or a theme toggle. Catppuccin Mocha is the only scheme, and a second one would double every contrast check.
- Don't swap in system fonts "for performance." Geist + Geist Mono (+ Newsreader on the landing page) are shipped self-hosted via `@fontsource-variable` and each carries a distinct job.
- Don't round panels. The sharp/soft contrast between cards and controls is the brand.
- Don't use `destructive` red for anything but genuinely destructive actions. It is a signal, not a color.
- Don't reuse the chart palette for chrome — those hues exist to differentiate data series, not UI.
- Don't add gradient fills, neon glows, or glassmorphism. The brand is restraint.
- Don't uppercase labels or buttons. Sentence-case throughout.
- Don't ship marketing-only chrome on workspace routes (or vice versa). One palette, one type system, end-to-end.
