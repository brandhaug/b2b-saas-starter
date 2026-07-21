# BeeSolo design brand and token system

Date: 2026-07-21

## Question

What visual language, design tokens, component conventions, responsive behavior, and brand expression define the BeeSolo product in `/Users/hassan/Desktop/beesolo HQ/beesolo-monorepo/apps/app`, and which parts should be carried into `b2b-saas-starter`?

## Research basis

This report is a primary-source audit of the BeeSolo source tree, not a screenshot reconstruction. The app imports most of its visual system from `/Users/hassan/Desktop/beesolo HQ/beesolo-monorepo/packages/design-system`, so both locations are in scope.

The inspected BeeSolo revision was `0a47403e`. Its worktree contained unrelated uncommitted planning changes, so this is an observed-source snapshot rather than a claim about a pristine release. No BeeSolo source files were changed.

Source citations below are relative to `/Users/hassan/Desktop/beesolo HQ/beesolo-monorepo/` unless stated otherwise.

## Executive read

BeeSolo's recognizable identity is a restrained black, white, and warm-honey product system:

- honey yellow `#ffdd33` is the invariant brand accent and always carries black text;
- near-pure neutrals do almost all structural work;
- Onest provides a friendly geometric voice without decorative typography;
- modest 8px geometry, borders, and low neutral shadows keep the product practical;
- a black four-cell honeycomb mark and lowercase `beesolo.` wordmark make the bee metaphor explicit;
- motion is quick and tactile, with the logo's staggered jump/pop providing the playful signature;
- layouts are mobile-first, touch-aware, and safe-area/PWA-aware;
- public booking is intentionally fixed-light, while authenticated and auth surfaces support light, dark, and system themes.

The best migration strategy is to adopt the semantic honey-and-neutral core, Onest, logo behavior, touch and reduced-motion rules, and component geometry. Do not copy BeeSolo's dead parallel palette, inconsistent raw status colors, bespoke auth-only radii/shadows, or its accidental 3.2px spacing base without an explicit decision.

## 1. Token architecture and precedence

The canonical runtime token source is `packages/design-system/styles/globals.css`. `apps/app/app/[locale]/styles.css` imports that file and does not redefine its semantic variables; it adds only an unavailable-time hatch utility. This means the effective order is:

1. canonical CSS custom properties in `packages/design-system/styles/globals.css`;
2. Tailwind v4 `@theme inline` aliases such as `--color-primary`;
3. shared component classes in `packages/design-system/components/**`;
4. app composition and local utility classes in `apps/app/**`;
5. occasional route-specific hard-coded overrides.

Evidence: `packages/design-system/styles/globals.css:12-234`; `apps/app/app/[locale]/styles.css:1-18`.

This is a semantic-token system rather than a complete primitive scale. It defines roles such as background, primary, muted, destructive, and border, but it does not provide a canonical named palette for every status or data state. That missing middle layer explains much of the raw Tailwind color use in feature code.

## 2. Canonical color system

Approximate hex values are included for quick visual communication; the OKLCH values are authoritative.

| Semantic role                  | Light                                     | Dark                          | Design function             |
| ------------------------------ | ----------------------------------------- | ----------------------------- | --------------------------- |
| `background`                   | `oklch(1 0 0)` / `#fff`                   | `oklch(.17 0 0)` / ~`#0f0f0f` | Page canvas                 |
| `foreground`                   | `oklch(0 0 0)` / `#000`                   | `oklch(.98 0 0)` / ~`#f8f8f8` | Primary text                |
| `card`, `popover`              | white                                     | `oklch(.21 0 0)` / ~`#181818` | Raised surfaces             |
| card/popover foreground        | black                                     | near-white                    | Surface text                |
| `primary`                      | `oklch(.9 .1739 96.8561)` / ~`#ffdd33`    | same                          | Brand action and emphasis   |
| `primary-foreground`           | black                                     | black                         | Required primary contrast   |
| `secondary`, `muted`, `accent` | `oklch(.96 0 0)` / ~`#f2f2f2`             | `oklch(.25 0 0)` / ~`#222`    | Quiet controls and grouping |
| secondary/accent foreground    | black                                     | near-white                    | Quiet-control text          |
| `muted-foreground`             | `oklch(.45 0 0)` / ~`#555`                | `oklch(.65 0 0)` / ~`#8f8f8f` | Secondary text              |
| `destructive`                  | `oklch(.5508 .1798 26.9575)` / ~`#c53732` | same                          | Destructive/error state     |
| destructive foreground         | white                                     | white                         | Destructive contrast        |
| `success`                      | `oklch(50.8% .118 165.612)` / ~`#007a55`  | same                          | Positive state              |
| `border`                       | `oklch(.92 0 0)` / ~`#e4e4e4`             | `oklch(.28 0 0)` / ~`#292929` | Structural separation       |
| `input`                        | same as light border                      | ~`#222`                       | Input surface/border        |
| `ring`                         | black                                     | `oklch(.8 0 0)` / ~`#bebebe`  | Focus indication            |

Evidence: `packages/design-system/styles/globals.css:12-45,90-123,158-191`.

### Honey is brand, not decoration

The same honey primary is used in both light and dark modes and paired with black in both. It is therefore an identity constant, not a theme-dependent highlight. The surrounding system is deliberately achromatic, making yellow scarce and meaningful.

The five chart colors stay in a honey/gold family across both modes rather than forming a rainbow: approximately `#edcc48`, `#b6b600`, `#c59800`, `#efb300`, and `#cd7a00`. This is strongly branded but weak for unrelated categorical series unless shape, labels, or patterns provide additional differentiation.

Evidence: `packages/design-system/styles/globals.css:19-20,33-37,97-98,111-115`.

### Sidebar subtheme

The sidebar has its own semantic roles. In light mode it is white/black with honey primary and ring, an almost-white accent, and a cool near-gray border. Dark mode uses the same dark raised-surface family as cards, with honey primary and ring.

Evidence: `packages/design-system/styles/globals.css:38-45,116-123`.

### Browser and PWA chrome

The app and merchant booking manifests choose white backgrounds and black `theme_color`, rather than honey chrome. This keeps the brand accent inside the UI and makes platform chrome visually neutral.

Evidence: `apps/app/app/manifest.ts:5-11`; `apps/app/lib/public-booking/manifest.ts:29-39`.

## 3. Typography

Onest is the product face. It is loaded through `next/font/google` with the Latin subset, `display: "swap"`, and preload enabled, then applied at the root with antialiasing and touch manipulation.

Evidence: `packages/design-system/lib/fonts.ts:4-16`; `apps/app/app/[locale]/layout.tsx:72-75`.

The stacks are:

- sans: `Onest, ui-sans-serif, sans-serif, system-ui`;
- serif: system UI serif stack;
- mono: system UI monospace stack.

Normal tracking is `0em`; the tight through widest variants derive from it by `-.05em`, `-.025em`, `+.025em`, `+.05em`, and `+.1em`. Bold is explicitly fixed at weight 700.

Evidence: `packages/design-system/styles/globals.css:66,74-78,85-87,193-197,220-234`.

The shared package also defines fluid text utilities from 12-14px at the smallest end through 36-64px at the display end, using `clamp()`. Headline sizes get tighter line-height and tracking; body sizes receive more generous line-height.

Evidence: `packages/design-system/lib/typography.ts:10-93`; `packages/design-system/styles/globals.css:470-535`.

Brand effect: Onest makes the interface feel approachable and contemporary, while black text and largely normal tracking keep operational screens direct. Lowercase brand copy and the terminal dot in `beesolo.` add informality without making body UI cute.

## 4. Spacing, sizing, radius, and elevation

### Spacing

The CSS sets `--spacing: 0.2rem`, or 3.2px at a 16px root. In Tailwind v4 that changes the generated spacing scale: `p-4` resolves to 12.8px rather than the more familiar 16px. Yet some layout code and comments clearly operate in conventional pixel expectations, and `.container` explicitly applies 16/24/32px padding through Tailwind utilities under this altered base.

This is the most consequential token oddity in the system. Treat it as an observed behavior to verify, not an unquestioned brand rule.

Evidence: `packages/design-system/styles/globals.css:86,155,232,326-365`.

### Radius

The base radius is 8px. Semantic radii resolve to:

| Token       | Value |
| ----------- | ----: |
| `radius-sm` |   4px |
| `radius-md` |   6px |
| `radius-lg` |   8px |
| `radius-xl` |  12px |

Evidence: `packages/design-system/styles/globals.css:46,199-202,218`.

The overall geometry is softened but not pill-heavy. Cards generally use 12px corners; standard inputs use 6px; many controls use 8px.

### Shadows

Elevation is quiet and neutral. The smallest shadows are a 1px/3px blur at 5% black. The common shadow uses two 10% black layers. Larger tokens mostly increase the second layer's vertical reach to 4px, 6px, or 10px; even `2xl` remains compact. Dark mode repeats the same black shadows rather than adapting them to lighter edge highlights.

Evidence: `packages/design-system/styles/globals.css:47-64,79-84,125-153`.

### Representative primitives

- Button: quick 150ms feedback, active scale around `.96`, minimum 40px pseudo hit target, and 3px focus halo.
- Card: bordered, `rounded-xl`, subtle shadow, generally 24px padding/gaps.
- Input: 36px visual height, `rounded-md`, subtle shadow, and 3px focus halo.

Evidence: `packages/design-system/components/ui/button.tsx:7-29`; `packages/design-system/components/ui/card.tsx:6-24`; `packages/design-system/components/ui/input.tsx:5-14`.

## 5. Layout and responsive strategy

The formal breakpoints are mobile-first min-width thresholds at 640, 768, 1024, 1280, and 1536px. The exported container constants say 640/768/1024/1280/1536px, while the CSS token maxima instead use 640/768/992/1200/1400px. That discrepancy is design-system debt: JavaScript helpers and actual CSS containers do not describe the same layout.

Evidence: `packages/design-system/lib/breakpoints.ts:8-47`; `packages/design-system/styles/globals.css:68-73,326-365`.

Mobile behavior is treated as a first-class product constraint:

- `min-h-dvh` avoids classic mobile viewport-height errors;
- safe-area support is enabled for standalone display mode;
- touch utilities offer 44, 48, and 56px targets;
- touch feedback scales active controls to `.95`;
- horizontal scrollbars can be hidden for touch scrollers;
- fluid typography scales continuously rather than only at breakpoints.

Evidence: `packages/design-system/styles/globals.css:301-317,403-468`; `packages/design-system/lib/mobile-first.ts:1-66`; `packages/design-system/lib/touch-targets.ts`.

## 6. Motion and interaction character

Canonical CSS motion is concise:

- accordion open/close: 200ms ease-out;
- logo letter jump: 400ms ease-out;
- logo dot pop: 300ms ease-out;
- basic touch feedback: 150ms ease-out.

Evidence: `packages/design-system/styles/globals.css:212-215,248-286,433-468`.

The brand animation is the distinctive part. On hover, each letter in `beesolo` jumps with a staggered delay, then the dot pops. It turns the wordmark into a tiny swarm-like sequence without changing the product's otherwise restrained motion language.

Evidence: `packages/design-system/components/logo.tsx:88-107,125-150`; `packages/design-system/styles/globals.css:433-450`.

Both CSS and the Motion provider respect reduced motion. The CSS collapses animation and transition duration under `prefers-reduced-motion`; the provider also configures Motion's reduced-motion behavior.

Evidence: `packages/design-system/styles/globals.css:419-429`; `packages/design-system/index.tsx:12-16`; `packages/design-system/providers/auth-provider.tsx:22-36`.

Feature code is less disciplined, using many local durations from 100 to 500ms and custom cubic Béziers. The sidebar, onboarding progress, and booking flow are representative. The feel remains fast, but there is no complete motion-token layer.

Evidence: `apps/app/app/[locale]/(authenticated)/components/sidebar.tsx:38-47`; `apps/app/app/[locale]/(authenticated)/components/onboarding-progress.tsx:56-113`; `apps/app/app/[locale]/(public-booking)/p/[username]/components/booking-flow/booking-flow-client.tsx:760-809`.

## 7. Logo, iconography, and imagery

### Logo

The canonical mark is four black hexagonal/honeycomb cells arranged inside a white square. The wordmark is lowercase `beesolo.` in bold Onest at a 24px default size with tight tracking. A matching static SVG is present in the app's public assets.

Evidence: `packages/design-system/components/logo.tsx:18-77,125-150`; `apps/app/public/logo.svg:1-7`.

The four cells are abstract enough to read as both honeycomb and modular product structure. Black-on-white gives the mark strong small-size recognition; honey is intentionally absent from the mark itself, leaving it available for action emphasis.

### Icons

The app overwhelmingly uses `lucide-react`, producing a consistent outline-icon language. Icons are usually 14-20px inside compact controls, with semantic foreground colors or reduced opacity. This supports the clean operational tone and avoids mixing filled decorative sets into dense workflows.

Evidence: imports across `apps/app/**/*.tsx`, including authenticated navigation, forms, booking, and public-profile components.

### Media and overlays

Public profile galleries and lightboxes intentionally step outside semantic surface tokens with near-black media canvases, white controls, alpha overlays, and gradients. These are functional image-viewing treatments rather than palette drift. Third-party marks such as Google's also retain their official colors.

Evidence: `apps/app/app/[locale]/(public-booking)/p/[username]/components/carousel-section.tsx:137,180-199`; `apps/app/app/[locale]/(public-booking)/p/[username]/components/image-lightbox.tsx:113-196`; `apps/app/app/[locale]/(unauthenticated)/google-mark.tsx:12-24`.

## 8. Theme behavior

The shared theme provider uses a root class, defaults to the system preference, enables system mode, and suppresses transitions during theme changes. Authenticated and unauthenticated route groups use it. The account UI exposes Light, Dark, and System choices.

Evidence: `packages/design-system/providers/theme.tsx:4-16`; `packages/design-system/components/mode-toggle.tsx:14-18,57-62`; `apps/app/app/[locale]/(authenticated)/layout.tsx:187-197`; `apps/app/app/[locale]/(unauthenticated)/layout.tsx:21-38`; `apps/app/app/[locale]/(authenticated)/account/components/change-theme.tsx:21-53`.

Public booking is different: it uses `DesignSystemProviderWithoutTheme`. Because the CSS has no media-query dark fallback, public booking resolves to the light variables unless another ancestor somehow retains a `.dark` class. Its map is explicitly forced to a light theme.

Evidence: `apps/app/app/[locale]/(public-booking)/p/layout.tsx:43-50`; `apps/app/app/[locale]/(public-booking)/p/[username]/components/location-map.tsx:24`.

No per-profile brand-color theming was found. Merchant identity is expressed through profile data, imagery, service content, and location—not through dynamically replacing BeeSolo's primary token. This is a platform-branded marketplace/booking surface, not a white-label theme engine.

## 9. Accessibility posture

Positive system-level signals include:

- semantic foreground/background pairings;
- black on honey for primary actions in both modes;
- visible ring tokens and 3px control halos;
- reduced-motion handling in CSS and Motion;
- touch-target utilities and coarse-pointer hit-area expansion;
- `dvh` and safe-area behavior for installed/mobile use;
- meaningful SVG title on the canonical logo.

Evidence: `packages/design-system/styles/globals.css:19-20,97-98,289-317,403-468`; `packages/design-system/components/ui/button.tsx:7-29`; `packages/design-system/components/logo.tsx:52-58`.

Risks that need verification rather than assumption:

- dark-mode muted foreground and dark shadows may not provide the intended visual separation;
- the same success/destructive colors are used in both themes;
- honey-family chart colors require non-color encodings for categorical accessibility;
- the public booking surface does not follow system dark mode;
- raw status colors in feature code bypass the canonical contrast model.

An automated contrast pass and keyboard/touch QA should accompany any migration.

## 10. Brand voice expressed through UI

The source does not expose a single formal voice guide, but the interface consistently implies these traits:

- **Warm and optimistic:** honey accent, friendly Onest, rounded but controlled geometry.
- **Direct and practical:** black/white hierarchy, short labels, dense operational surfaces, minimal ornament.
- **Independent-professional rather than enterprise-corporate:** lowercase wordmark, animated letters, personal public profiles, mobile-first booking.
- **Trust through restraint:** platform chrome remains black/white; yellow is focused on identity and action rather than flooding the canvas.
- **Playful in moments, not everywhere:** the logo animates, but normal workflows use quick, quiet feedback.

These are inferences from the implemented system, especially `globals.css`, the logo component, auth/onboarding composition, and public booking components. They should not be treated as quoted brand strategy.

## 11. Fragmentation and design debt

### Dead secondary palette

`apps/app/lib/constants.ts` declares another bee palette containing honey, dark gray, white, orange, brown, light/dark honey, and grays, but the audit found no usage in the app or shared packages. It is a parallel vocabulary with no runtime authority.

Evidence: `apps/app/lib/constants.ts:1-11`.

### Yellow drift

Canonical honey appears hard-coded as `#FFDD33` for public-profile stars and the map pin, while notification indicators use `#FFD02B`. These should resolve through semantic tokens such as brand, rating, attention, or unread—not independent hex literals.

Evidence: public profile `profile-server.tsx:146,286`; `location-map.tsx:46`; `components/notification-center/notification-center.tsx:86`; authenticated `user-dropdown.tsx:88,132`; `mobile-user-actions.tsx:64,78`.

### Raw state colors

A broad scan found hundreds of nonsemantic color occurrences, concentrated in service forms, client views, availability previews, calendar/status utilities, and upgrade banners. Many use raw red, green, blue, orange, and gray scales. Some are valid media/third-party exceptions, but operational status colors need semantic roles and paired foregrounds.

Representative evidence: `apps/app/app/[locale]/(authenticated)/clients/components/clients-table.tsx:33-35`; booking calendar `utils.ts:96-106,199`; `apps/app/components/upgrade-triggers/upgrade-banner.tsx:35-45`.

### Auth micro-system

Sign-in, sign-up, and closed-beta screens use an attractive but separate geometry/elevation language: 11px and 14px radii, hand-authored RGBA hairline shadows, 150ms transitions, and many arbitrary opacity values. It is visually intentional but not represented in shared semantic tokens.

Evidence: `apps/app/app/[locale]/(unauthenticated)/sign-in/custom-sign-in.tsx:27-37,258`; sibling sign-up component `custom-sign-up.tsx:27-37,279`; `closed-beta/closed-beta-onboarding.tsx:69-97`.

### Token duplication and disagreement

- `--radius` is declared more than once in the canonical stylesheet.
- CSS container values and TypeScript container helpers disagree.
- shadow primitive metadata coexists with separately spelled-out named shadows.
- the 3.2px base spacing alters every Tailwind spacing utility and is easy to misunderstand.
- app feature motion lacks semantic duration/easing tokens.

These issues do not erase the brand system, but copying the implementation wholesale would copy ambiguity with it.

## 12. Migration guidance for `b2b-saas-starter`

### Adopt

1. **Core brand roles:** honey primary `oklch(.9 .1739 96.8561)`, black primary foreground, achromatic light/dark surfaces, neutral borders, and explicit success/destructive roles.
2. **Onest as the customer/merchant product face:** use one loading mechanism and expose it through a shared font token.
3. **Logo system:** four-cell black mark, lowercase `beesolo.` wordmark, icon-only form, transparent-background option, and reduced-motion-safe staggered animation.
4. **Semantic component contract:** components consume `background`, `foreground`, `card`, `muted`, `border`, `ring`, `primary`, and paired foregrounds rather than raw palette values.
5. **Geometry:** 8px base radius with a 4/6/8/12px semantic scale, restrained borders, and low shadows.
6. **Mobile rules:** 44px minimum interactive target, `dvh`, safe areas, touch feedback, fluid type where appropriate, and merchant-first responsive composition.
7. **Theme boundary:** allow authenticated product surfaces to follow Light/Dark/System; keep public booking fixed-light only if that is an explicit product decision.

### Adapt deliberately

1. **Spacing:** preserve the visible compactness, but implement it with an explicit, documented scale. Do not silently set Tailwind's base unit to 3.2px unless every consumer and test expects it.
2. **Containers:** choose one canonical set. The current starter should not inherit both 992/1200/1400 and 1024/1280/1536 definitions.
3. **Status colors:** introduce semantic roles such as `warning`, `info`, `positive`, `attention`, `unread`, `rating`, and calendar-state pairs before moving feature styles.
4. **Auth polish:** either promote its 11/14px radii and hairline shadows into documented auth-surface tokens or normalize it to the product primitives.
5. **Charts:** keep honey as the anchor series, but use distinguishable categorical colors and non-color encodings for multi-series data.
6. **Dark elevation:** test whether black-only shadows work on the starter's dark surfaces; consider border/light-edge treatment where needed.
7. **Public booking theme:** decide whether platform consistency or end-user system preference wins, then encode and test the decision.

### Do not copy

1. The unused `apps/app/lib/constants.ts` palette.
2. Hard-coded `#FFD02B` notification yellow or duplicated `#FFDD33` literals.
3. Raw feature-level Tailwind colors without semantic purpose and foreground pairing.
4. Conflicting breakpoint/container definitions.
5. Undocumented arbitrary radii, opacity, shadow, duration, and easing values.
6. A theme implementation that assumes `dark` class state will exist on a provider-less subtree.

## 13. Suggested target token layers

The starter will be easier to evolve if BeeSolo's visual language is expressed in four explicit layers:

1. **Primitive:** honey and neutral ramps, status ramps, type families, base spacing, raw radii, duration/easing, shadow recipes.
2. **Semantic:** background/content/surface/border/action/focus/status/data roles with paired foregrounds.
3. **Component:** control heights, card padding, dialog radius, navigation sizes, booking tiles, calendar states, auth-field treatment.
4. **Context:** merchant app light/dark, public booking, marketing, auth/onboarding, PWA/standalone safe-area behavior.

This retains BeeSolo's visual identity while making precedence and exceptions visible.

## 14. Implementation sequence

1. Record the visual identity decision: honey/black/white, Onest, logo, and theme boundaries.
2. Add a single shared token source with light and dark semantic roles.
3. Resolve spacing and container discrepancies before porting components.
4. Add missing status/data tokens with contrast-tested foregrounds.
5. Port primitives in order: button, input/textarea/select, card, badge, dialog/drawer, navigation, toast.
6. Port product patterns: mobile shell, empty/loading/error states, booking cards, calendar states, profile/gallery, auth/onboarding.
7. Replace hard-coded yellows and status colors with semantic roles.
8. Add visual regression coverage for light, dark, public booking, mobile viewport, and reduced motion.
9. Verify contrast, keyboard focus, coarse-pointer targets, safe areas, and installed-PWA presentation.

## 15. Acceptance checklist for a faithful recreation

- Honey is the sole primary brand action color and always uses black foreground.
- Onest is loaded once and applied consistently.
- The mark and `beesolo.` wordmark match the source proportions and casing.
- Light surfaces are white/near-white; dark surfaces use the observed near-black/card-gray hierarchy.
- Borders and shadows remain quiet; elevation does not become glossy or heavily layered.
- Core controls use the 4/6/8/12px radius language unless a documented context token overrides it.
- Mobile controls meet a 44px effective target and safe-area behavior is verified.
- Reduced-motion users do not receive jump/pop or large transition motion.
- Public booking theme behavior is deliberate and tested.
- No copied component introduces unexplained raw honey, status colors, breakpoints, or spacing.

## Bottom line

BeeSolo's brand is strong because it is simple: warm honey for identity and action, black-and-white structure, a friendly geometric face, a compact operational rhythm, and one memorable animated wordmark. The shared design system captures that core well. The app then reveals where the system is incomplete—especially status colors, auth-specific treatments, motion, and token consistency.

For `b2b-saas-starter`, preserve the identity and interaction principles, but rebuild the token hierarchy cleanly. A faithful recreation should look unmistakably BeeSolo while being more explicit, more accessible, and easier to maintain than the source implementation.
