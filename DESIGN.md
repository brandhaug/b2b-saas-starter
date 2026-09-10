# Design

The public site and Reference Application share shadcn/ui, Tailwind semantic tokens, and one Catppuccin Mocha scheme. Public pages distinguish themselves through composition and landing-page display type. [PRODUCT.md](PRODUCT.md) defines the audience and voice.

[apps/web/src/index.css](apps/web/src/index.css) is the source of truth for color values, typography tokens, radii, and theme scopes. Component variants own control dimensions. Change those definitions rather than maintaining copies here.

## Colors

Use semantic utilities. Raw colors belong in the stylesheet, apart from the document's theme-color metadata. There is no light-mode branch or theme toggle.

- Mauve `primary` marks the main action or selection. Reserve one primary action per region.
- Neutral `secondary` gives an action more weight than outline without competing with primary. `muted` separates nested content; `accent` supplies hover states.
- Cards and popovers use the darker mantle color with a one-pixel border. Input edges use the lighter `input` token so controls remain distinguishable from their surroundings.
- `destructive` marks destructive actions and refusals. Use `status-ok`, `status-warn`, and `status-info` for operational states; chart tokens belong to data series.
- Peach `signal` marks schematics and `.band-deep` calls to action. That scope darkens whole sections and changes primary to peach.
- Sidebar components use `sidebar-*` tokens. Overlays use `overlay/80`.

The `.marketing` wrapper owns public typography, prose, and focus treatment. It does not introduce another palette.

## Typography

Self-hosted family names must match Fontsource: `Geist Variable`, `Geist Mono Variable`, and `Newsreader Variable`.

Geist handles body text and headings. Geist Mono handles code, identifiers, and tabular numeric data. Newsreader is limited to the landing hero and section headings through `font-display`, with optical size 72; never use it for workspace, card, or small-text headings.

| Content                         | Treatment                                                          |
| ------------------------------- | ------------------------------------------------------------------ |
| Landing hero / section headings | Newsreader, `text-5xl` to `text-6xl` / `text-3xl` to `text-4xl`    |
| Other page titles               | Geist `text-3xl`; workspace shell title `text-xl`                  |
| Article section headings        | `text-xl` h2, `text-base` h3                                       |
| Card titles                     | Geist `text-lg font-semibold`                                      |
| Body and controls               | `text-base` below `md`, `text-sm` above; long-form prose `text-lg` |
| Micro text                      | Mono hints, table headers, and schematic labels only               |

Use sentence case. Keep input text at 16px on mobile to avoid focus zoom. Micro sizes are unsuitable for prose or interactive labels.

## Layout and shape

Use the four-pixel spacing scale through Tailwind utilities. Public layouts cap at `max-w-7xl`, articles at `max-w-3xl`, and workspace page bodies at `max-w-4xl`. Sticky content clears the shared header; anchor offsets must leave headings visible.

The workspace sidebar has a fixed desktop width and a mobile sheet. Touch controls render at least 44px tall below `md`. Desktop controls use 36px by default; 32px variants are limited to dense row/menu actions.

Panels and dialogs have square corners. Controls use the softer `rounded-md` radius. Keep panels flat with one-pixel borders; reserve restrained shadows for floating menus and tooltips, and blur for overlays. Use `bg-muted` for nested content instead of nesting cards.

## Components

- Outline is the default action treatment; ghost suits row actions and dismissals. Confirm destructive changes.
- Alerts use their semantic tint and an icon, not an ordinary card treatment.
- [badge-variants.ts](apps/web/src/lib/badge-variants.ts) maps status and role to variants. Mauve means current/selected; unknown free-text status uses outline.
- Docs code blocks use Shiki's Catppuccin Mocha theme on the card background.

Avoid gradients, neon glows, glassmorphism, decorative notches, and illustration-heavy marketing. The interface should give commands, data, and decisions visual priority.

## Accessibility

Target WCAG 2.1 AA: body-text contrast at least 4.5:1, large-text and control contrast at least 3:1. Verify actual rendered surfaces, including deep bands and translucent fills.

Provide visible two-pixel focus rings with offsets, keyboard navigation, semantic landmarks, a skip link, and accessible names. Honor `prefers-reduced-motion` for every animation. Status meaning must remain understandable without color.
