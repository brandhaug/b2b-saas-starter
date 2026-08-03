# Deterministic evidence harness

This harness proves that a target scenario is reproducible. It does **not** prove
legacy visual parity: the two runs below are both target runs, and no legacy
screenshot is used as an oracle. Do not treat a green smoke run as visual-parity
acceptance until a reviewed legacy reference bundle and visual comparison are wired
into the scenario.

The supported harness exercises named scenarios through the Booking browser entry and
produces reviewable evidence under `apps/booking/parity-evidence/`.

Run the Booking development ingress, then run:

```bash
bun --cwd apps/booking parity:smoke
```

Every scenario owns a versioned manifest and content-addressed fixture. A run receives
an injected instant and timezone, an isolated namespace, deterministic optional-provider
outcomes, and a strict origin allowlist. The runner captures semantic assertions,
canonical fixture state, mutation history, screenshot, DOM/accessibility state, console,
requests, HAR, and Playwright trace. It executes each smoke scenario twice and fails if
the screenshot or canonical-state hashes differ. Every namespace is a fresh Seed
capability graph behind the production Booking HTTP handler. Authenticated, internal
reset, snapshot, mutation-log, provider-double, and local content-addressed asset
endpoints are exposed only by the ephemeral fixture server.

Smoke journeys enter through the Public Site on port 3071, matching the production
service-binding boundary. Normal runtime never falls back to fixture data.
