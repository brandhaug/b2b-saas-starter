---
name: B2B SaaS Starter
description: An inspectable visual system for a Cloudflare-first B2B SaaS foundation.
colors:
  background: 'oklch(0.2429 0.0304 283.911)'
  foreground: 'oklch(0.8787 0.0426 272.277)'
  card: 'oklch(0.2155 0.0254 284.065)'
  primary: 'oklch(0.7871 0.1187 304.769)'
  primary-foreground: 'oklch(0.1828 0.0204 284.204)'
  secondary: 'oklch(0.324 0.0319 281.978)'
  muted: 'oklch(0.324 0.0319 281.978)'
  muted-foreground: 'oklch(0.751 0.0396 273.932)'
  accent: 'oklch(0.4037 0.032 280.152)'
  destructive: 'oklch(0.7556 0.1297 2.7642)'
  border: 'oklch(0.324 0.0319 281.978)'
  input: 'oklch(0.5497 0.0345 277.095)'
  ring: 'oklch(0.8166 0.091 277.309)'
  signal: 'oklch(0.8237 0.1015 52.6294)'
  status-ok: 'oklch(0.8577 0.1092 142.715)'
  overlay: 'oklch(0.1828 0.0204 284.204)'
typography:
  display:
    fontFamily: 'Cabinet Grotesk, Geist Variable, ui-sans-serif, sans-serif'
    fontSize: 'clamp(2.5rem, 7.5vw, 6rem)'
    fontWeight: 600
    lineHeight: 1
    letterSpacing: '-0.035em'
  headline:
    fontFamily: 'Cabinet Grotesk, Geist Variable, ui-sans-serif, sans-serif'
    fontWeight: 600
  title:
    fontFamily: 'Geist Variable, ui-sans-serif, sans-serif, system-ui'
    fontSize: '1.5rem'
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: 'Geist Variable, ui-sans-serif, sans-serif, system-ui'
  label:
    fontFamily: 'Geist Mono Variable, ui-monospace, monospace'
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.25
  mono:
    fontFamily: 'Geist Mono Variable, ui-monospace, monospace'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: '4px'
  md: '6px'
  base: '8px'
  lg: '0px'
  xl: '0px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '32px'
  2xl: '48px'
  3xl: '64px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-foreground}'
    rounded: '{rounded.md}'
    padding: '0 12px'
    height: '36px'
  button-outline:
    backgroundColor: 'color-mix(in oklab, {colors.input} 30%, transparent)'
    textColor: '{colors.foreground}'
    rounded: '{rounded.md}'
    padding: '0 12px'
    height: '36px'
  input:
    backgroundColor: 'color-mix(in oklab, {colors.input} 30%, transparent)'
    textColor: '{colors.foreground}'
    rounded: '{rounded.md}'
    padding: '0 12px'
    height: '36px'
  panel:
    backgroundColor: '{colors.card}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    padding: '24px'
  public-nav:
    backgroundColor: '{colors.card}'
    textColor: '{colors.muted-foreground}'
    rounded: '9999px'
    padding: '4px 8px'
---

# Design system: B2B SaaS Starter

## Overview

**Creative North Star: "Cinematic Center"**

The public showcase puts the repository's evidence in the middle of the frame. Cabinet Grotesk gives landing pages a firm display voice, while Geist keeps the app, docs, forms, and data readable. Catppuccin Mocha supplies one dark scheme across every route, so a color decision made in the showcase remains valid in the Reference Application.

The system moves between cinematic public chapters and operational product density. Public sections can use a photo, shader, workspace capture, code trace, or decision card when that material explains the Starter. Workspace and knowledge routes keep their compact controls, direct navigation, and bounded reading columns. Motion adds orientation and emphasis, while the content remains usable when motion is reduced or unavailable.

**Key Characteristics:**

- Dark Catppuccin Mocha tokens expressed in OKLCH.
- Cabinet Grotesk landing display type with fluid hero sizing.
- Geist and Geist Mono for product text, code, identifiers, and tabular numbers.
- Square bordered panels paired with softly rounded controls.
- Proof-led public composition with bento cards, trace tabs, provider disclosure, decision cards, and a pausable marquee.
- Dense, task-first workspace and documentation layouts.

## Colors

Catppuccin Mocha carries the whole product. Mauve marks primary actions and selection. Peach is the signal color for architecture marks and deep call-to-action bands. Green, yellow, and blue communicate operational status. The values below match `apps/web/src/index.css`.

### Primary

- **Mauve** (`oklch(0.7871 0.1187 304.769)`): Main actions, selected states, active trace tabs, and the public navigation emphasis.

### Secondary

- **Surface 0** (`oklch(0.324 0.0319 281.978)`): Secondary actions, muted nested content, separators, and panel borders.

### Tertiary

- **Peach signal** (`oklch(0.8237 0.1015 52.6294)`): Architecture schematics, deep-band calls to action, and code numbers.
- **Green status** (`oklch(0.8577 0.1092 142.715)`): Successful or healthy state.
- **Yellow status** (`oklch(0.9193 0.0704 86.5281)`): Warning and provider-gated state.
- **Blue status** (`oklch(0.7664 0.1113 259.885)`): Informational state and code functions.

### Neutral

- **Base** (`oklch(0.2429 0.0304 283.911)`): Default page background.
- **Mantle** (`oklch(0.2155 0.0254 284.065)`): Cards, popovers, sidebar, and code panels.
- **Crust** (`oklch(0.1828 0.0204 284.204)`): Overlay scrim, deep public bands, and primary button ink.
- **Text** (`oklch(0.8787 0.0426 272.277)`): Main copy and headings.
- **Subtext** (`oklch(0.751 0.0396 273.932)`): Supporting copy and quiet labels.
- **Surface 1** (`oklch(0.4037 0.032 280.152)`): Hover surfaces and sidebar accents.
- **Overlay 0** (`oklch(0.5497 0.0345 277.095)`): Control edges and input fills.
- **Lavender ring** (`oklch(0.8166 0.091 277.309)`): Keyboard focus indicator.
- **Red destructive** (`oklch(0.7556 0.1297 2.7642)`): Destructive action and refusal state.

**The single-scheme rule.** Keep `:root` as the one Catppuccin Mocha source. `.band-deep` changes only the background, primary, secondary, accent, and ring roles it needs, then inherits the rest.

## Typography

**Display font:** Cabinet Grotesk, loaded from the local variable `cabinet-grotesk-variable.woff2` (41 KB), with Geist Variable as fallback.

**Body font:** Geist Variable, with system sans fallbacks.

**Label and code font:** Geist Mono Variable, with system monospace fallbacks.

Cabinet Grotesk is reserved for the landing page's hero, chapter headings, decision cards, and stack marquee. Geist carries the application, docs, auth, controls, and ordinary headings. Geist Mono marks commands, paths, schematic labels, table headers, identifiers, and tabular numbers.

### Hierarchy

- **Display** (600, `clamp(2.5rem, 7.5vw, 6rem)`, line-height 1, tracking `-0.035em`): Centered public hero headings that stay within two or three lines at the supported narrow widths.
- **Headline** (600, fluid from `1.875rem` to `3rem`, line-height 1.1): Public chapter headings and large proof statements.
- **Title** (600, `1.5rem`, line-height 1.25): Workspace shell titles and prominent document titles.
- **Body** (400, `1rem`, line-height 1.5): Product copy and form text. Long prose uses a bounded reading column.
- **Label** (400, `0.75rem`, line-height 1.25): Mono captions, field metadata, table headers, and schematic labels.

**The one display voice rule.** Use Cabinet Grotesk for public display moments. Keep workspace, docs, auth, and small card headings in Geist.

## Layout

The four-pixel spacing scale sets the rhythm. Public containers use `max-w-7xl`; the centered hero and bento proof use `max-w-6xl`; long-form articles use `max-w-3xl`; the docs index uses `max-w-6xl`. The home page's `<main>` uses `max-w-full overflow-x-hidden` so wide content never expands the document.

The public hero centers its heading and two CTAs in a `max-w-6xl` frame over a dark radial wash and an infrastructure image. The proof chapter uses a 12-column grid with a 7+5 first row and a 5+7 second row, `grid-flow-dense`, and no empty bento cells. Major public chapters use 6xl or 7xl containers with 24 to 32 spacing units on large screens. The request trace uses tabs to select one readable code or runtime view, with its schematic pinned beside it on desktop and placed after the content on mobile.

The public header is sticky, 64px high, and capped at `max-w-7xl`. Desktop navigation sits in a bordered rounded pill. Mobile navigation moves into a sheet with 44px touch targets. Public provider disclosure is horizontal on large screens and vertical on small screens. Workspace navigation is a 240px desktop sidebar with a mobile sheet, while docs articles keep a sidebar on desktop and a disclosure navigation on mobile.

Workspace lists put search and filter controls above records. On mobile, search stays visible and secondary filters open from a labeled disclosure with an active count. Settings, auth forms, and record details stack into one column without horizontal document overflow. Code and table bodies scroll inside their own bounded regions and receive a keyboard focus stop.

## Elevation & Depth

The system uses tonal layering and one-pixel borders for most depth. Cards, code blocks, and panels are flat against the mantle. `shadow-md` is for floating menus, popovers, and tooltips. `shadow-lg` is for sheets and dialogs. Public depth comes from the crust band, a radial backdrop, the infrastructure image, LightRays, image scale, and the stacked decision cards. These effects support the evidence on screen and never replace it.

**The flat panel rule.** Keep resource panels and cards flat with a one-pixel border. Use elevation for an overlay that needs separation from the page.

## Shapes

Panels, cards, code blocks, deep bands, and public image frames use square corners. Controls use `rounded-md`, which resolves to 6px from the 8px root radius. Small inline code uses `rounded-sm`, 4px. The public desktop navigation is the one pill-shaped container because it groups site links as a single control. Borders are semantic `border-border` or `border-input`; do not add decorative notches or clipping shapes.

## Components

### Buttons

Buttons are compact and direct. The default height is 36px on desktop and 44px below `md`; large actions are 44px. Primary uses mauve with crust text. Outline uses a 30% input fill and input edge. Secondary uses surface 0. Ghost is for row actions and dismissals. Destructive uses a red tint and red focus ring. Every button keeps a two-pixel visible focus ring with a two-pixel offset.

### Cards and containers

Cards are square, bordered, and flat on the mantle. Public proof cards use 6px or 8px padding units, fill their bento cell, and expose a border and background change on hover. Linked workspace imagery scales to 1.025 on hover and focus. Decision cards are opaque so the pinned stack remains legible while the next card passes over it.

### Inputs and fields

Inputs use a quiet card background, an overlay 0 edge, 6px radius, and 36px desktop height. Auth controls keep 16px text on mobile to avoid focus zoom. Search remains visible on mobile list pages. Focus uses the semantic ring. Validation adds a destructive border and ring without relying on color alone.

### Navigation

Public navigation uses a sticky header, a centered desktop pill, and a mobile sheet. Workspace navigation groups workspace activity, administration, developer tools, and personal destinations, with personal links at the sidebar foot. Docs navigation remains available through a mobile disclosure. Active links retain a mauve inset ring and filled accent background.

### Trace tabs

The request trace exposes request, contract, capability, and runtime stages as native tabs. Tab labels stay in a horizontally scrollable row when needed. Each selection reveals one bounded snippet or runtime table and lights the related architecture nodes. The schematic and stage content keep an accessible text description in the document.

### Provider disclosure

Optional providers render as an accordion. Desktop uses a horizontal row with the selected panel wider than its siblings. Mobile stacks the same providers vertically. The warning status and environment-gated copy remain visible, and each panel links to the real provider documentation.

### Motion and imagery

The public page uses lazy client-only GSAP for the pausable stack marquee, ScrollTrigger decision-card stacking, and image scale/fade sequences. LightRays uses a semantic primary color in a bounded WebGL canvas and pauses when off-screen, hidden, or reduced motion is requested. `prefers-reduced-motion` removes entrance, trace, and panel transitions. Images have intrinsic dimensions, descriptive text where they carry information, and focus-visible responses when linked.

## Do's and Don'ts

- **Do** use the exact OKLCH values from `apps/web/src/index.css` as the color source.
- **Do** keep Cabinet Grotesk on the public display path and Geist on app, docs, auth, and operational content.
- **Do** give public pages a clear center of attention, then let repository proof carry the claim.
- **Do** keep the hero centered, fluid, and within two or three lines at 320px and 390px in English and Norwegian Bokmål.
- **Do** keep the four-card proof grid dense, gapless, and based on real repository modules and the seeded Reference Application.
- **Do** disclose optional providers horizontally on desktop and vertically on mobile.
- **Do** preserve operational density, direct navigation, permissions, and locale behavior in workspace, docs, and auth routes.
- **Do** make the trace tabs, marquee, stacked cards, image responses, and accordions usable without motion.
- **Don't** add a second color scheme, raw marketing colors, or token values that disagree with `index.css`.
- **Don't** use a second display face, serif body text, fake customer claims, portraits, adoption counts, or simulated provider activity.
- **Don't** turn real repository paths and commands into decorative numbered labels.
- **Don't** hide search, selected filters, or sorting behind a mobile control that loses their URL state.
- **Don't** make an opaque decision card translucent or allow a public image or code block to widen the document.
- **Don't** use gradients, neon glows, glassmorphism, decorative notches, or illustration-heavy marketing as the product's evidence.
