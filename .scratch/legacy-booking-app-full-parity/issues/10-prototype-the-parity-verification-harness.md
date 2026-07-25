# Prototype the Parity Verification Harness

Type: prototype
Status: resolved
Blocked by: 02, 03

## Question

What deterministic fixture format, screenshot procedure, interaction-test structure, viewport and locale matrix, visual-diff tolerances, animation controls, and evidence format can reliably prove 1:1 legacy parity throughout incremental delivery?

## Answer

The accepted throwaway prototype is [Parity Harness Prototype](../../../apps/booking/prototypes/parity-harness/README.md). The human review found its manifest-driven capture plan and independent evidence gates suitable as the basis for the production harness.

The harness contract is one versioned manifest per named observable-state scenario. A manifest identifies its schema version, content-addressed fixture version, fixed instant and timezone, route, ordered semantic actions and assertions, locale, viewport/input/embedding profile, feature and provider profiles, motion policy, and visual-diff policy. Fixture payloads, local assets, provider responses, and expected canonical server state are addressed by the scenario rather than embedded in browser tests. Every run begins from an atomic reset into an isolated run namespace and ends by comparing the canonical state snapshot and mutation log.

Interaction tests are thin Playwright-style journeys generated from the manifest: reset the scenario, open the declared route, execute semantic user actions through accessibility-facing locators, assert each named browser-observable state, and capture evidence at explicit checkpoints. Blank, loading, error, overlay, recovery, and timing-sensitive states are positive assertions rather than incidental screenshots. Tests must not depend on order, wall-clock time, production credentials, mutable remote assets, or undeclared network access.

The full state inventory runs first at 375×812 touch in English. English, Spanish, French, and Romanian each run the complete shared-layout and copy contract at that mobile profile. Representative page architectures and every responsive, pointer, hover, or embedding branch additionally run at a 768×900 iframe host with a 375×700 widget, 1024×768 mouse/hover, and 1440×900 mouse/hover. A scenario may omit a matrix cell only through an explicit, reviewed waiver recorded in its manifest.

Static checkpoints use finish-and-freeze motion: inject the fixed clock before application code, disable caret and incidental CSS animation, allow declared transitions to finish under controlled virtual time, then capture. Choreography checkpoints use sample-timeline motion with named timestamps and video/trace evidence. Exact pixel matching is the default. A narrowly scoped antialias mask may be declared for a stable element and renderer only; it cannot hide geometry, color, typography, crop, overlay, focus, or motion differences and cannot be combined with timeline captures. There is no global percentage tolerance.

Each checkpoint emits an evidence bundle containing the manifest and fixture hashes, fixed time/timezone, route and executed actions, flags and provider profiles, locale, browser/build identity, viewport/input/embedding profile, screenshots, DOM and accessibility snapshots, console output, failed and undeclared requests, trace/HAR, canonical API state and mutation log, and video for timing-sensitive journeys. Acceptance requires visual, canonical-state, and interaction matches; complete metadata; zero undeclared requests and console errors; and identical screenshot and canonical-state hashes across two clean runs. These gates fail independently so an apparently correct screenshot cannot conceal behavioral or determinism drift.

This resolution fixes the verification architecture but does not turn the prototype into production infrastructure. The implementation plan should create the real scenario schema, fixture server integration, Playwright runner, evidence storage/reporting, and CI matrix as delivery work. No new Wayfinder decision or fog graduation is required.
