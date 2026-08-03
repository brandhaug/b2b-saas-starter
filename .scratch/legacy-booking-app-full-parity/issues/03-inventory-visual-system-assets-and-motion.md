# Inventory the Legacy Visual System, Assets, and Motion

Type: research
Status: resolved
Blocked by: 01

## Question

What exact tokens, fonts, icons, illustrations, animations, layout rules, responsive rules, styled-component variants, overlays, transitions, and asset licenses form the legacy Booking App's visual contract, and how should each map into a dedicated StyleX theme and primitive vocabulary?

## Answer

The complete source-cited contract and migration matrix is recorded in [Legacy Booking App Visual System, Assets, and Motion Inventory](../research/legacy-visual-system-assets-and-motion-inventory.md).

The legacy visual contract is a mobile-width, full-height widget capped at 375 CSS px, built on a 4 px spacing grid, exact semantic color and opacity ramps, bundled SF Pro and Bebas Neue faces, 150 ms interaction and 300 ms page motion, a seven-field runtime premium-brand palette, explicit semantic component variants, and a fixed overlay hierarchy from ordinary content through sheets, processing, promotional overlays, toasts, and tooltips. The source contains 96 SVGs and four WOFF2 files; remote tenant imagery and colors remain fixture-dependent, while the referenced group-appointment Lottie JSON is absent from the checked-in static tree.

The StyleX target should be a dedicated `bookingTheme`, not an extension of the starter-wide theme. Stable StyleX variables should encode spacing, semantic colors and expanded alpha ramps, typography recipes, motion timing, breakpoints, and layer names. A premium `stylex.createTheme` override should be computed at the booking boundary. Typed booking primitives should own the observed variants and data states, while Framer Motion remains responsible for presence, layout, and coordinated exit choreography that StyleX cannot express alone.

Parity acceptance must cover computed styling at 375 px, viewport-height extremes, overlay order and scroll containment, exact transition sequencing, SVG geometry/color snapshots, and remote-image crop/fallback behavior. Invisible focus-visible and reduced-motion improvements are permitted without changing pointer-visible parity.

Asset presence does not establish redistribution rights: no local license manifest or notices were found for the fonts, SVGs, provider marks, or missing Lottie asset. [Establish Visual Asset Provenance and Replacement Policy](./13-establish-visual-asset-provenance-and-replacement-policy.md) now owns closing that evidence gap. [Prototype the StyleX Parity Architecture](./09-prototype-stylex-parity-architecture.md) already owns runtime validation of this proposed vocabulary, so no other ticket or fog graduation is required.
