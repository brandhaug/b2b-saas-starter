# Merchant mobile-sheet density audit

Research date: 2026-07-23
Scope: current BeeSolo Merchant App source only. This is the local baseline to compare with the separately observed first-party Poke mobile sheets. No product code was changed for this audit.

## Executive summary

The sheet motion shell is already separated from the scrollport, but the visible content uses a desktop-card density inside a mobile sheet. The “chunky” feeling comes primarily from five cumulative choices:

1. A route sheet begins only **24 px** below the viewport and occupies the remaining height, but then reserves a large top stack for a **44 px drag zone**, safe-area-aware header, **44 px close control**, and **20 px bold title**.
2. Every route sheet inserts a generic eyebrow plus description before the actual route content.
3. Most route content then adds another **32 px** top margin.
4. Settings uses repeated padded cards (`p-6`, or **24 px**) with **32 px** gaps, while the observed Poke Settings sheet uses compact grouped rows.
5. The settings navigation itself uses **76 px minimum-height rows**, **28 px icons**, **18 px bold labels**, and a **30 px chevron**.

The highest-value density change is therefore not a smaller corner radius. It is to remove the universal metadata block from the visible sheet, simplify the mobile header, and introduce mobile-specific grouped rows / sections instead of rendering desktop cards and tables unchanged.

## Authenticated Poke sheet measurements

Source for this section: direct, read-only inspection of the signed-in first-party
[`poke.com`](https://poke.com/) app at a **390 × 844 px** viewport on 2026-07-23.
Settings and Automations were opened by clicking their visible home controls.
Recipes and Message were not opened. The connected browser exposes a viewport
override but not a mobile User-Agent/device-profile override, so these values
verify Poke's phone-width CSS layout, not UA-gated or OS-specific behavior.

### Shared sheet shell

Settings and Automations use the same phone-width sheet grammar:

| Part                  |       Measured Poke value |
| --------------------- | ------------------------: |
| Viewport              |              390 × 844 px |
| Sheet top             |                  25.32 px |
| Sheet height          |       818.68 px (`97dvh`) |
| Sheet width           |                    390 px |
| Top corners           |                     36 px |
| Drag handle           |                 40 × 4 px |
| Handle top inset      | 12 px from the sheet edge |
| Header height         |                     68 px |
| Header title          |    14 / 20 px, weight 500 |
| Header alignment      |                  centered |
| Visible close control |                      none |
| Content scrollport    |  independently scrollable |

The sheet is almost full-height, but its chrome is visually quiet. The 36 px
corners and 40 px handle are not what make a sheet chunky; hierarchy does.
Poke keeps the centered title at ordinary UI size and avoids placing a 44 px
close button beside it. The sheet implementation also clips content to the
rounded surface and lets the region own vertical scrolling.

### Settings density

Poke's loaded Settings sheet measured:

| Part                 |               Measured Poke value |
| -------------------- | --------------------------------: |
| Avatar               |                        64 × 64 px |
| Display name         |  Exposure, 20 / 28 px, weight 400 |
| Account identifier   |  Exposure, 14 / 20 px, weight 500 |
| Sheet content gutter |                             16 px |
| Group width          |    358 px including a 1 px border |
| Group radius         |                             16 px |
| Group background     |           very light neutral gray |
| Gap between groups   |                             36 px |
| Row height           |                          52–53 px |
| Row padding          |                             16 px |
| Leading icon         |                        20 × 20 px |
| Icon-to-label gap    |                             12 px |
| Label                | OpenRunde, 14 / 20 px, weight 500 |
| Trailing chevron     |                        16 × 16 px |

The important pattern is a **single grouped surface**, not a card around every
setting. Borders and background are quiet; the 52–53 px row supplies the touch
target while the visible icon and type stay small.

### Automations density

The Automations sheet reuses the same 36 px shell and 14 / 20 px, weight-500
header title. Its empty state uses:

| Part                       |                Measured Poke value |
| -------------------------- | ---------------------------------: |
| Empty-state title          |             18 / 28 px, weight 500 |
| Supporting copy            |             14 / 20 px, weight 400 |
| Copy width                 |                             275 px |
| Title-to-copy gap          |                               8 px |
| Copy-to-primary-action gap |                              32 px |
| Primary action             | 36 px high, 14 / 20 px, weight 500 |
| Primary action padding     |    8 px vertical, 20 px horizontal |
| Secondary action           |             14 / 20 px, weight 500 |
| Primary-to-secondary gap   |                              12 px |

Poke does not make every action 48–56 px tall. The prominent pill is only
36 px high while retaining a larger interaction area through the surrounding
layout. The visual weight comes from contrast, not oversized type.

## Poke-to-BeeSolo delta

| Element                 |                    Poke |                        BeeSolo now | Recommended BeeSolo target |
| ----------------------- | ----------------------: | ---------------------------------: | -------------------------: |
| Sheet title             |              14/20, 500 |                         20 px bold |              15–16/22, 600 |
| Visible close icon      |                    none |          28 px inside 44 px target | remove from visible header |
| Header bottom stack     |     compact 68 px total | handle + safe area + 20 px padding |             60–68 px total |
| Content gutter          |                   16 px |                     at least 20 px |                      16 px |
| Settings row            |                52–53 px |                     at least 76 px |                   54–56 px |
| Leading icon            |                   20 px |                              28 px |                   20–22 px |
| Settings label          |              14/20, 500 |                         18 px bold |             15/22, 550–600 |
| Chevron                 |                   16 px |                   30 px text glyph |              16–18 px icon |
| Settings grouping       | 16 px radius, no shadow |          24 px-padded shadow cards |     grouped hairline lists |
| Generic route copy      | none above task content |              eyebrow + description |          remove by default |
| Route first-content gap |          route-specific |             commonly another 32 px |                   12–16 px |

Because BeeSolo uses Onest rather than OpenRunde, the recommended values are an
optical translation rather than a literal font copy. Onest should remain the
product font, with less weight and smaller visible geometry.

## Current route-sheet measurements

| Part                          | Current source value                 |                                  Effective measurement |
| ----------------------------- | ------------------------------------ | -----------------------------------------------------: |
| Top reveal                    | `mt-6`                               |                                                  24 px |
| Sheet height                  | `calc(100dvh - 1.5rem)`              |                                   viewport minus 24 px |
| Top corners                   | `rounded-t-[2.25rem]`                |                                                  36 px |
| Drag zone                     | `h-11`, `pt-3`, `-mb-4`              | 44 px box, visually overlaps following header by 16 px |
| Handle                        | `h-1 w-10`                           |                                              4 × 40 px |
| Header horizontal padding     | `merchant-safe-area-inline` + `px-5` |                               at least 20 px each side |
| Header top padding            | `max(1.25rem, safe-area-inset-top)`  |      at least 20 px; commonly larger on notched phones |
| Header bottom padding         | `pb-5`                               |                                                  20 px |
| Close target                  | `size-11`                            |                                             44 × 44 px |
| Close icon                    | `size-7`                             |                                             28 × 28 px |
| Title                         | `text-xl font-bold tracking-tight`   |                                            20 px, bold |
| Scrollport horizontal padding | `px-5` + safe-area helper            |                                         at least 20 px |
| Scrollport bottom padding     | `max(2rem, safe-area-inset-bottom)`  |                                         at least 32 px |

Source: [`mobile-shell.tsx`](../../../apps/merchant/src/components/merchant-shell/mobile/mobile-shell.tsx#L487-L548) and the safe-area definition in [`index.css`](../../../apps/merchant/src/index.css#L684-L687).

### Important safe-area compounding

The sheet is already offset 24 px from the top, yet its header independently applies the full top safe-area inset. On a notched phone, the path to the title is therefore approximately:

`24 px outer reveal + 28 px effective handle region + safe-area top + 20 px bottom padding`

before accounting for the title line itself. This makes the top chrome visually dominant. The close target also consumes one of three equal header slots even though the Poke mobile model observed in the existing research has no visible X control.

Source: [`mobile-shell.tsx`](../../../apps/merchant/src/components/merchant-shell/mobile/mobile-shell.tsx#L504-L540). The existing Poke observation is recorded in [`official-public-source-layout-evidence.md`](./official-public-source-layout-evidence.md#L121-L130).

## Universal metadata adds a second header

Every non-home route is prefixed by:

- a 12 px uppercase, semibold eyebrow with 0.08 em tracking;
- an 8 px gap;
- a 14 px description with 24 px line-height;
- then the route child.

Most route children independently start with `mt-8` (32 px). A two-line description therefore consumes roughly **80–104 px** between the sheet title and the first useful control:

`12–16 px eyebrow + 8 px gap + 48 px description + 32 px child margin`

This is the clearest source of perceived padding because the text is explanatory product copy rather than task content. On narrow screens, long route descriptions often wrap to three or more lines.

Source: [`mobile-shell.tsx`](../../../apps/merchant/src/components/merchant-shell/mobile/mobile-shell.tsx#L540-L548). Examples of the additional 32 px child margin appear in [`settings.tsx`](../../../apps/merchant/src/routes/settings.tsx#L64-L90), [`customers.tsx`](../../../apps/merchant/src/routes/customers.tsx#L22-L28), [`services.tsx`](../../../apps/merchant/src/routes/services.tsx#L33-L40), and [`availability.tsx`](../../../apps/merchant/src/routes/availability.tsx#L36-L43).

## Settings and navigation are desktop-density components

### Settings navigation

The mobile settings menu currently uses:

- minimum row height: **76 px**;
- gap between icon and label: **16 px**;
- icon container: **40 px**;
- icon: **28 px**;
- label: **18 px bold**;
- trailing glyph: **30 px**, light.

By comparison, the existing authenticated Poke research measured grouped About/Settings rows at approximately **52–53 px** high. BeeSolo rows are therefore about **44% taller** before considering their larger icon and label weights.

Source: [`mobile-navigation-menu.tsx`](../../../apps/merchant/src/components/merchant-shell/mobile/mobile-navigation-menu.tsx#L25-L55). Poke measurement: [`official-public-source-layout-evidence.md`](./official-public-source-layout-evidence.md#L99-L119).

### Settings route

The Settings content repeats:

- **32 px** before every section (`mt-8`);
- **24 px** internal padding (`p-6`);
- 12 px corner radius (`rounded-xl`);
- border plus shadow;
- 18 px semibold section title;
- explanatory text under every title.

Four stacked cards are a desktop dashboard grammar. In a mobile bottom sheet, these borders, shadows, outer gaps, and inset content create several nested surfaces and make every action feel larger than its importance.

Source: [`settings.tsx`](../../../apps/merchant/src/routes/settings.tsx#L58-L180).

### Other routes

The same sheet renders route-owned desktop layouts unchanged:

- Customers is an `overflow-x-auto` table with 16 px cell padding.
- Services is a bordered two-pane editor that only switches at `lg`.
- Availability is a bordered two-column layout that only switches at `lg`.

These technically fit via scrolling or stacking, but they do not share the compact grouped-list grammar of the mobile shell.

Sources: [`customers.tsx`](../../../apps/merchant/src/routes/customers.tsx#L14-L64), [`services.tsx`](../../../apps/merchant/src/routes/services.tsx#L23-L92), and [`availability.tsx`](../../../apps/merchant/src/routes/availability.tsx#L28-L120).

## Calendar-sheet measurements

The calendar is a separate inset sheet:

| Part                        |                    Current measurement |
| --------------------------- | -------------------------------------: |
| Side / bottom inset         |                                   8 px |
| Corner radius               |                                  40 px |
| Minimum height              | 464 px, capped to viewport minus 16 px |
| Header horizontal padding   |                                  20 px |
| Header top / bottom padding |                             32 / 20 px |
| Month title                 |                             24 px bold |
| Navigation targets          |                             40 × 40 px |
| Navigation icons            |                 24 px, stroke weight 3 |
| Weekday text                |                             14 px bold |
| Day targets                 |                             44 × 44 px |
| Day text                    |                         18 px semibold |
| Grid horizontal padding     |                                  24 px |

This sheet is internally consistent but visually heavy because the **40 px radius**, **24 px title**, bold weekday labels, 18 px dates, and stroke-3 chevrons all compete at the same visual weight. It also differs from the route-sheet shell (8 px inset versus edge-to-edge, 40 px versus 36 px corners), so the app has two sheet density systems.

Source: [`mobile-calendar-sheet.tsx`](../../../apps/merchant/src/components/merchant-shell/mobile/mobile-calendar-sheet.tsx#L321-L404) and [`index.css`](../../../apps/merchant/src/index.css#L545-L617).

## Typography baseline

BeeSolo uses **Onest Variable** globally, with weights from 100–900. Poke's measured sheets use **OpenRunde** for general UI. These fonts have different width, x-height, and weight behavior, so copying Poke's nominal pixel sizes is not enough; the BeeSolo implementation should be optically calibrated in Onest.

The current shell also overuses `font-bold`: route title, navigation labels, calendar title, weekdays, and Today action are all bold. This flattens hierarchy and contributes as much to “chunkiness” as padding.

Sources: [`onest.css`](../../../apps/merchant/src/onest.css#L1-L50), global assignment in [`index.css`](../../../apps/merchant/src/index.css#L89-L90), and measured Poke typography in [`official-public-source-layout-evidence.md`](./official-public-source-layout-evidence.md#L21-L47).

## Recommended target for the comparison pass

These are local design recommendations, not claims about unmeasured Poke values:

1. **Keep 44 px touch targets**, but render smaller visual icons (20–22 px) inside them.
2. **Remove the visible X on mobile route sheets** and let the handle / drag gesture communicate dismissal; retain an accessible nonvisual dismissal path and browser Back.
3. **Use one compact title row**: approximately 17–18 px at 600–650 weight, with 12–16 px horizontal gutters.
4. **Do not render the eyebrow and generic route description by default on mobile.** Put essential help text beside the specific control it explains.
5. **Reduce first-content separation** to 12–16 px instead of route-owned `mt-8`.
6. **Replace Settings cards with grouped rows** around 52–56 px high, 20–22 px icons, 15–16 px labels, hairline separators, and no per-row shadows.
7. **Create mobile renderers for tables and two-pane editors** rather than depending on horizontal overflow.
8. **Unify sheet tokens** (top gap, corner radius, inner gutter, title size, row height) between route and calendar sheets.

The implementation should preserve touch-target size, native scrolling, safe-area handling, and the existing gesture/motion system while reducing only the visible geometry and typographic weight.
