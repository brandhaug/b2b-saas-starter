# Inventory Legacy Booking Journeys and Observable States

Type: research
Status: resolved
Blocked by:

## Question

What complete route, journey, interaction, responsive, locale, loading, empty, validation, failure, recovery, feature-flag, and edge-state matrix does the legacy Booking App expose, and which states are runnable versus inferred from source?

## Answer

The complete source-cited matrix is recorded in [Legacy Booking App Journey and Observable-State Inventory](../research/legacy-booking-journey-state-inventory.md).

The legacy app exposes 12 customer route patterns, one deliberate error route, and blank widget chrome for unmatched paths. Its observable contract spans standard and group appointments, assigned and unassigned gift cards, reservation management, waiting-list offers and reschedules, walk-in enrollment, explicit checkout phases, payment and integration variants, English/French/flag-gated Spanish localization, standalone/widget/Google embedding, view-mode navigation changes, and width/pointer-responsive behavior.

Reachability is the decisive constraint: route shells, unmatched paths, the deliberate error route, and unresolved blank/loading behavior are runnable from the checked-out source tree; successful data-backed journeys and nearly all alternate states are source-inferred because the local environment lacks deterministic entity identifiers, fixture seeds, feature-flag snapshots, authenticated/cart state, and provider sandboxes. Their rendering branches are nevertheless directly observed in source.

The inventory also names legacy quirks that later decisions must treat explicitly: silent loading, perpetual skeletons for empty professionals, blank empty-service and waiting-list terminal states, missing catch-all UI, malformed gift-card assumptions, hard-coded walk-in drawer data, and timing-sensitive route/app-link behavior. “Establish a Reproducible Legacy Parity Baseline” owns converting the inferred matrix into deterministic runtime evidence; the existing downstream dependency, domain, compatibility, integration, localization, StyleX, and verification tickets already cover every newly clarified decision surface, so no additional ticket or fog graduation is required.
