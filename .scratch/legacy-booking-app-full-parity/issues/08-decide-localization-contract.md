# Decide the Localization Contract

Type: grilling
Status: resolved
Blocked by: 01, 04

## Question

What locale detection, selection, route behavior, translation ownership, fallback behavior, date/time/currency/phone formatting, validation copy, and layout constraints are required for strict English, Spanish, and French parity in the new architecture?

## Answer

The rebuild supports four first-class **Booking Locales**: English, Spanish, French, and Romanian. English, Spanish, and French retain strict legacy parity; Romanian is an intentional extension and must satisfy the same completeness, validation-copy, fallback, layout, accessibility, and CI requirements. All four locales are always available; the legacy Spanish rollout flag is removed.

Canonical booking URLs remain locale-neutral. Locale resolution is, in order: the Booking Session's stored locale, the persisted browser preference, the first supported language detected from the browser, then English. Changing language updates both the Booking Session and browser preference without navigating or restarting the journey. Confirmation and continuation links recover the Booking Session locale. Unsupported or malformed locale inputs follow the same fallback chain rather than producing an error route.

The language picker remains available throughout every nonterminal booking journey. A change rerenders the current screen immediately while preserving the route, Booking Party, selections, holds, entered customer data, and validation state, plus scroll and focus context where practical. Locale changes never mutate pricing, scheduling, or other domain invariants.

`apps/booking` owns bundled and versioned UI catalogs. Every product-owned UI and validation key must exist in `en`, `es`, `fr`, and `ro`; CI fails on missing keys. Production never exposes raw keys. An unexpected lookup failure falls back to English and emits diagnostics. Merchant Catalog owns translations of merchant-authored names and descriptions. Missing merchant content falls back to the merchant's source language and displays the legacy-style partial-translation indicator.

Formatting has an explicit boundary:

- Date language/order and hour-cycle conventions follow the Booking Locale profiles `en-US`, `es`, `fr-CA`, and `ro-RO`.
- Customer-visible appointment times always render in the Shop's IANA timezone, never implicitly in the browser timezone.
- Currency and minor-unit precision come from the accepted quote's ISO currency; separators and symbol placement follow the Booking Locale.
- Phone country selection defaults from Shop country but remains user-selectable. Inputs display in the selected country's familiar format and cross the application boundary normalized and validated as E.164.
- API contracts carry ISO instants, IANA timezone identifiers, ISO currency codes, integer minor units, and E.164 phone numbers, never presentation-formatted values.

Effect schemas and capabilities return stable typed validation/error codes with structured parameters, not customer-facing prose. `apps/booking` translates those codes at render time, so changing locale rerenders existing errors. CI requires all four translations for every exposed code. Unknown codes become a localized generic error and emit diagnostics.

All locales share the same component hierarchy and interaction model. Text may wrap and layouts may grow vertically; instructions, validation, prices, dates, and primary actions may not be truncated. Touch targets and operability must survive expansion. Narrow, documented locale-specific typography adjustments are allowed when required for parity, including known French and Spanish legacy treatments, but separate locale-specific page layouts are not. Every text-heavy state must pass the parity viewport matrix, long-copy cases, and 200% text zoom; overflow, overlap, clipping, or copy-induced inaccessible controls are parity failures.

This decision sharpens **Booking Locale** in `CONTEXT.md`. No further wayfinding ticket is required: catalog production, Romanian translation, locale-aware primitives, and contract implementation belong in the final dependency-ordered delivery plan.
