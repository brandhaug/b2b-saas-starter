# Poke desktop shell and dialog audit

Research date: 2026-07-26
Scope: Poke `/home` and the desktop surfaces opened by the visible About,
Settings, Automations, Integrations, and Mail controls. Recipes and Messages are
excluded because they redirect.

## Evidence

The first background browser connection was unavailable, but a second signed-in
in-app Browser session succeeded during the same pass. From `/home`, the visible
Automations control was clicked (rather than navigating directly), opening the
authenticated `/automations` desktop dialog while the real home remained mounted.
At the session's 1280 × 720 viewport, the live dialog measured 512 × 752 px at
x 384 / y -16, its overlay was transparent with a computed 4 px backdrop blur,
and its compact title measured 14 / 20 px at weight 500. This report combines
that fresh validation with:

1. The repository's prior read-only authenticated click audit of the first-party
   [`https://poke.com/home`](https://poke.com/home) UI, captured on 2026-07-20:
   [`official-public-source-layout-evidence.md`](../../.scratch/poke-home-layout/research/official-public-source-layout-evidence.md).
2. The prior authenticated phone-width measurements, captured on 2026-07-23:
   [`merchant-mobile-sheet-density-audit.md`](../../.scratch/poke-home-layout/research/merchant-mobile-sheet-density-audit.md).
3. The current first-party app shell and versioned production assets fetched from
   Poke on 2026-07-26:
   [`/home`](https://poke.com/home),
   [`main-CtGUTzKH.js`](https://poke.com/vc-ap-d2a57d/main-CtGUTzKH.js), and
   [`main-DzG4LrTk.css`](https://poke.com/vc-ap-d2a57d/main-DzG4LrTk.css).

The exact geometry below was measured in the authenticated UI. Implementation
claims are independently supported by identifiable class strings and component
behavior in the current first-party JavaScript bundle.

## Desktop `/home` shell

At a 1440 × 1000 viewport, Poke renders a fixed phone-proportioned app surface
inside an atmospheric full-browser background:

| Element                            |      Observed desktop value |
| ---------------------------------- | --------------------------: |
| Home card                          |                448 × 750 px |
| Position at 1440 × 1000            |                x 496, y 125 |
| Card radius                        |                       24 px |
| Card color in observed night theme | `rgb(17 23 32)` / `#111720` |
| Header horizontal inset            |                       16 px |
| About and Settings targets         |                  44 × 44 px |
| Primary action tiles               |       204 × 78 px, 8 px gap |
| Secondary action tiles             |      133 × 78 px, ~8 px gap |
| Tile radius / inner padding        |               24 px / 12 px |

The current DOM implementation confirms the frame: `ICCardsViewLayout` centers
`[data-silk-sheet-wrapper]` with `w-full max-w-md md:h-[750px]`; `max-w-md`
resolves to 448 px. `ICContentCard` adds the desktop `rounded-3xl` (24 px), and
the header is `px-4`. The home remains fixed-height on short desktop windows and
is symmetrically cropped rather than compressed.

Typography has two roles:

| Role             | Family    | Size / line-height |  Weight |
| ---------------- | --------- | -----------------: | ------: |
| Greeting         | Exposure  |         24 / 32 px |     400 |
| Status/weather   | OpenRunde |         16 / 24 px |     500 |
| Date             | OpenRunde |         14 / 20 px |     500 |
| General controls | OpenRunde |           14–16 px | 400–500 |

The practical lesson is that desktop is not a wide dashboard. It is a centered,
bounded product frame with atmospheric space around it.

## Desktop destination modal

Visible controls on `/home` were previously clicked to inspect About, Settings,
Automations, Integrations, and Mail. They share one desktop modal grammar:

| Element                 |                          Observed / production value |
| ----------------------- | ---------------------------------------------------: |
| Breakpoint              |                        desktop at `min-width: 768px` |
| Modal width             |                          512 px (`w-[95%] max-w-lg`) |
| Modal height            |     752 px measured; 750 px inner drawer plus border |
| Position at 1440 × 1000 |                                         x 464, y 124 |
| Radius                  |                                24 px (`rounded-3xl`) |
| Surface                 | opaque white/background token, bordered, `shadow-lg` |
| Scroll ownership        |    fixed outer modal; inner `h-full overflow-y-auto` |
| Close target            |               approximately 32 × 32 px, 20 px X icon |

The modal is deliberately 64 px wider than the 448 px home card, but keeps the
same visual height and radius. This promotes the task without turning it into a
full desktop page.

### Backdrop and underlay

The current `DialogOverlay` is a fixed full-viewport layer with
`backdrop-blur-xs`; it does **not** declare a dark translucent background. In the
current Tailwind output, the small backdrop blur is 4 px. The real mounted home
surface remains visible behind the portal and is made inert while the child route
is open. This is a blur-only desktop treatment, not a dark scrim and not a cloned
or replacement underlay.

### Entrance and exit motion

The current `DialogContent` declares a 200 ms transition and Radix state classes:

- open: fade in, scale from 95% to 100%, and settle into the centered position;
- close: fade out, scale to 95%, and apply the complementary slight slide;
- easing/position: fixed at 50% / 50%, with `transform: translate(-50%, -50%)`
  and inline `transition: all 0.2s ease-out`.

This is a short desktop zoom/fade—not the longer mobile drag spring. The overlay
fades on the same open/closed state classes.

### Header spacing and typography

`ICNavigationHeader` provides a compact, symmetric header:

- `mt-4 mb-1` (16 px above, 4 px below);
- 48 px fixed height;
- 24 px horizontal padding on desktop (`md:px-6`);
- 40 px reserved leading and trailing slots, keeping the title truly centered;
- title at 14 / 20 px, weight 500, black;
- close button at the trailing edge with 6 px padding around a 20 px X, yielding
  an approximately 32 px control.

The title is intentionally ordinary UI text. Poke does not use a 20–24 px bold
sheet title merely because the content is modal.

### Dismissal and focus

The desktop implementation uses a Radix dialog. It traps focus, closes through
the trailing X, and supports the primitive's outside-click and Escape dismissal.
The responsive layout's `onOpenChange` returns to `/home`; the close button also
routes home. Nested modal code explicitly moves focus from the outgoing panel to
the incoming panel.

## Surface-specific layout

### Automations

- Centered 14 / 20 px, weight-500 header.
- Top controls/filtering remain inside the fixed modal frame.
- Content uses `px-4 md:px-8`, so desktop content has 32 px side gutters.
- The empty state uses an 18 px medium title, 14 px copy constrained to 275 px,
  an 8 px title-to-copy gap, 32 px before the primary action, and 12 px between
  primary and secondary actions.
- The Add Automation button is visually compact: 14 px text and 8 px vertical /
  20 px horizontal padding.

### Settings and About

- Both use compact grouped lists rather than separate oversized cards.
- Rows are approximately 52–53 px high with 20 px leading icons, 14 / 20 px
  weight-500 labels, 16 px chevrons, and 16 px row padding.
- Groups use a quiet light-neutral surface, 1 px border, and 16 px radius.

### Integrations

- A single horizontal filter/action row sits below the title.
- Connected accounts use rounded cards; the library uses grouped 68 px list rows
  with icon, label, optional status/description, and a trailing affordance.

### Mail

- The mailbox selector is left-aligned rather than forcing a centered title.
- Search and unread-filter controls remain above the independently scrolling list.
- Message rows are approximately 110 px high; the list is about 441 px wide in
  the 512 px modal.
- A 36 × 36 px compose control stays anchored at the lower-right.

These differences show that the shell is shared while title alignment, pinned
controls, and scroll content remain route-specific.

## Responsive distinction

The production code branches at exactly 768 px:

- **≥768 px:** centered Radix modal, `max-w-lg`, 24 px corners, desktop close X,
  short 200 ms fade/zoom/slide.
- **<768 px:** Silk bottom sheet, 36 px top corners, 40 × 4 px handle, no desktop
  close button, `97dvh` default height, swipe dismissal, click-outside and Escape
  dismissal, and `smooth` entering/exiting sheet settings.

At 390 × 844 the observed sheet begins around 25 px from the top, is 390 ×
818.7 px, and owns its content scroll. The underlying real home view transforms,
rounds, and dims during sheet travel; that mobile underlay behavior should not be
copied into the desktop dialog.

## Actionable design for the Merchant new-appointment desktop flow

1. **Use one centered desktop dialog, not the mobile sheet stretched wider.** At
   ≥768 px target 512 px wide, up to ~752 px tall, 24 px corners, opaque surface,
   and an inner scrollport.
2. **Keep the real appointments home mounted behind it.** Make it inert and use a
   blur-only 4 px overlay; do not replace it, add a second rounded underlay, or
   apply a dark scrim.
3. **Use desktop motion.** Enter/exit over about 200 ms with opacity plus a subtle
   95%↔100% scale and small centering slide. Reserve spring/drag physics for the
   <768 px sheet.
4. **Adopt the compact header grammar.** Use a 48 px header, 24 px desktop side
   padding, symmetric 40 px slots, 14–16 px medium title, and a ~32 px X target.
5. **Separate chrome from scrolling.** Client/service/date/time fields scroll
   inside the modal; the header and the primary completion action should stay
   anchored when content exceeds the viewport.
6. **Keep visual density close to Poke.** Prefer 14–16 px labels, 52–56 px grouped
   rows, 16–20 px icons, 16 px group radius, and 16–32 px route-specific gutters
   over large cards and 20–24 px headings.
7. **Reuse the frame for substeps.** Client, service, and time selection should
   replace or laterally transition the modal content within the same 512 px frame,
   preserving focus and scroll ownership instead of stacking unrelated full-screen
   surfaces.
8. **Preserve the existing mobile branch.** The current mobile new-appointment
   sheet can retain its native drag/detent model; desktop should switch shell and
   motion at 768 px without changing the flow's information architecture.

## Confidence

- **High:** current production bundle classes/behavior, breakpoint, modal max
  width, inner height, radius, header geometry/type, blur-only overlay, 200 ms
  dialog motion, and scroll ownership.
- **High:** earlier authenticated click measurements and safe-route content
  layouts, because they were captured directly from the first-party app.
- **High:** the authenticated Automations loaded state and exact computed runtime
  geometry after hydration, freshly verified by clicking from `/home` on
  2026-07-26.
