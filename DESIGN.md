# Design

The public site and Reference Application share shadcn/ui, Tailwind semantic tokens, and one Catppuccin Mocha scheme. Public pages distinguish themselves through composition and landing-page display type. [PRODUCT.md](PRODUCT.md) defines the audience and voice.

[apps/web/src/index.css](apps/web/src/index.css) is the source of truth for color values, typography tokens, radii, and theme scopes. Component variants own control dimensions. Change those definitions rather than maintaining copies here.

## Colors

Use semantic utilities. Raw colors belong in the stylesheet, apart from the document's theme-color metadata. There is no light-mode branch or theme toggle.

- Mauve `primary` marks the main action or selection. Reserve one primary action per region.
- Neutral `secondary` gives an action more weight than outline without competing with primary. `muted` separates nested content; `accent` supplies hover states.
- Cards and popovers use the darker mantle color with a one-pixel border. Input edges use the lighter `input` token so controls remain distinguishable from their surroundings.
- `destructive` marks destructive actions and refusals. Use `status-ok`, `status-warn`, and `status-info` for operational states, in charts as well as chrome: the dashboard's bars carry a health judgement, so the scheme ships no separate chart palette.
- Peach `signal` marks schematics and `.band-deep` calls to action. That scope darkens whole sections and changes primary to peach.
- Sidebar components use `sidebar-*` tokens. Overlays use `overlay/80`.

The `.marketing` wrapper owns public typography, prose, and focus treatment. It does not introduce another palette.

## Typography

Self-hosted family names must match Fontsource: `Geist Variable`, `Geist Mono Variable`, and `Newsreader Variable`.

Geist handles body text and headings. Geist Mono handles code, identifiers, and tabular numeric data. Newsreader is limited to the landing hero and section headings through `font-display`, with optical size 72; never use it for workspace, card, or small-text headings.

| Content                         | Treatment                                                       |
| ------------------------------- | --------------------------------------------------------------- |
| Landing hero / section headings | Newsreader, `text-5xl` to `text-6xl` / `text-3xl` to `text-4xl` |
| Other page titles               | Geist `text-3xl`; workspace shell title `text-2xl`              |
| Article section headings        | `text-xl` h2, `text-base` h3                                    |
| Card titles                     | Geist `text-lg font-semibold`                                   |
| Body                            | `text-sm` at every width; long-form prose `text-lg`             |
| Form controls and their labels  | `text-base` below `md`, `text-sm` above                         |
| Micro text                      | Mono hints, table headers, and schematic labels only            |

Use sentence case. Keep input text at 16px on mobile to avoid focus zoom. Micro sizes are unsuitable for prose or interactive labels.

## Layout and shape

Use the four-pixel spacing scale through Tailwind utilities. Public layouts cap at `max-w-7xl`, articles at `max-w-3xl`, and workspace forms and overview at `max-w-4xl`. Member, audit, token, and webhook lists use `max-w-7xl` so comparable records have room to align. Sticky content clears the shared header; anchor offsets must leave headings visible.

The workspace sidebar has a fixed desktop width, independent scrolling, and a mobile sheet. Separate workspace activity, administration, developer tools, and personal navigation. Personal navigation stays at the sidebar foot. Active navigation uses a one-pixel inset mauve border over its filled background; keyboard focus keeps its separate ring. Settings names the configuration destination; General names its identity tab. Touch controls render at least 44px tall below `md`. Desktop controls use 36px by default; 32px variants are limited to dense row/menu actions.

Panels and dialogs have square corners. Controls use the softer `rounded-md` radius. Use separators between resource rows and contextual menus for secondary row actions. Search, filters, and pagination belong above or below the list, with selected views retained in the URL. Keep panels flat with one-pixel borders; reserve restrained shadows for floating menus and tooltips, and blur for overlays. Use `bg-muted` for nested content instead of nesting cards.

Tables and resource lists use a compact control for each filterable field. Select
fields open a searchable single-choice list; text, date, and number fields pair
their operator and value in a small popover. Dashed triggers show the selected
value in place, and an All/Any control appears when two or more filters are active.
On mobile, developer lists keep search visible and put filters and sort controls
in a disclosure with their active count. Sort rows run in their listed priority.
Tables put search and filters on the left
of one toolbar and the searchable column picker on the right. Changes reset
pagination and stay in the URL. Audit events and failed deliveries apply the
selected view on the server before paging. Keep field choices tied to each page's
records and translate the controls with the rest of the app.

## Page composition

The overview gives attention the main column and setup a narrower secondary column on wide screens. Notifications use a quieter separated list. Setup progress is a native progress element styled with the shared primary and muted tokens in both Chromium and Firefox; optional developer guidance opens in a disclosure.

Settings align the field explanation and a bounded control on desktop, stacking them on mobile. Save actions sit in a consistent footer. Separate destructive actions from everyday edits without making them the brightest region. Member rows group initials, name, and email; role and actions align at the end.

Audit places its toolbar directly above records. Keep pagination guidance at the footer rather than adding an extra panel heading. Delivery attempts use a status marker, summary, timestamp, and expandable request/response evidence. Diagnostic text has a labeled header, copy feedback, wrapping control, and a keyboard-scrollable body.

Sign-in and sign-up use a dedicated split shell. The form is the primary task, with one h1, a bounded width, and a quiet field background. A desktop-only panel introduces the reference workspace using factual product copy. Mobile keeps the form, legal links, language control, and support. Other authentication steps retain the compact shared shell.

The landing hero pairs the value proposition with runnable setup commands. Keep the headline within two desktop lines and the actions in the first viewport. Use a compact request trace with optional code evidence, followed by descriptive provider roles. Public demo actions consistently say Explore demo.

The public demo band includes a labeled screenshot of the reference workspace linked to the demo. Refresh `apps/web/public/images/workspace-preview.webp` when overview composition changes: capture `/demo` at 1440 by 1000 pixels and encode it as lossless WebP. The screenshot loads eagerly because it enters the first mobile viewport. It is illustrative, while the adjacent counts come from the showcase loader.

The docs index starts with Quickstart, then groups articles by category in
content-sized lists. Demo credential actions fill the sign-in form without
submitting it and focus the password field; dismissing the sheet returns focus
to its trigger. Inactive assistant views link to provider setup.

## Components

- Outline is the default action treatment; ghost suits row actions and dismissals. Confirm destructive changes.
- Alerts use their semantic tint and an icon, not an ordinary card treatment.
- [badge-variants.ts](apps/web/src/lib/badge-variants.ts) maps status and administrative role emphasis to variants. Member rosters use neutral role labels so identity leads the row; the administrative membership editor retains owner emphasis. Mauve means current/selected; unknown free-text status uses outline.
- Docs code blocks use Shiki's Catppuccin Mocha theme on the card background.

Avoid gradients, neon glows, glassmorphism, decorative notches, and illustration-heavy marketing. The interface should give commands, data, and decisions visual priority.

## Accessibility

Target WCAG 2.1 AA: body-text contrast at least 4.5:1, large-text and control contrast at least 3:1. Verify actual rendered surfaces, including deep bands and translucent fills.

Provide visible two-pixel focus rings with offsets, keyboard navigation, semantic landmarks, a skip link, and accessible names. Honor `prefers-reduced-motion` for every animation. Landing motion is limited to a brief hero entrance and interaction feedback. Architecture diagrams are static apart from active-node feedback; authentication has no ambient animation. Status meaning must remain understandable without color.

## Interaction feedback

Keyboard-operated overlays, buttons, switches, accordions, and documentation
jumps settle immediately. Pointer
presses on shared buttons use a small scale response. The document records the
input method before control handlers run, including controls in portals.

Base UI starting and ending states drive interruptible popup and sheet
transitions. Sheets move from their anchored edge; dialogs stay centered.
Reduced motion retains fades and removes movement. The command palette opens
and closes immediately, fits the dynamic viewport, and scrolls its results.
Accordion height transitions reverse from their current position.

Submit buttons reserve spinner space. Copy controls announce success or failure
beside the action and keep the source available for manual selection.
