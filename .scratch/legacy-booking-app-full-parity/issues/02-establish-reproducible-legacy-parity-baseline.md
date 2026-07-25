# Establish a Reproducible Legacy Parity Baseline

Type: task
Status: resolved
Blocked by: 01

## Question

Can the legacy Booking App be run deterministically for every discovered journey, and what fixtures, environment substitutes, viewport matrix, screenshots, recordings, and state-capture procedure are required to make its observable contract reproducible without production data or credentials?

## Answer

The decision-complete baseline contract is recorded in [Reproducible Legacy Parity Baseline](../research/reproducible-legacy-parity-baseline.md).

No reproducible full-journey baseline currently exists. The checked-out legacy Booking App and local API are development-bootable and expose a narrow, mutable happy path, but the production build fails under TypeScript 6, fixture dates depend on the wall clock, process-local state has no scenario namespace/reset/snapshot contract, unknown identifiers commonly alias the same success data, visual assets remain remote, feature flags have one fixed profile, provider SDKs are not deterministically substituted, and there is no automated browser-capture harness. The current runtime can support manual exploration; it cannot be the auditable authority for full parity.

The required authority is a scenario-addressable local fixture server with an injected clock, isolated run namespaces, atomic reset and canonical state-snapshot endpoints, local content-addressed assets, named flag/locale/embedding/storage profiles, and deterministic doubles for external providers. Its minimum viewport/input set is 375×812 touch, 376×812 touch, a 768×900 iframe host with a 375×700 widget, 1024×768 mouse/hover, and 1440×900 mouse/hover. The full state matrix runs at 375 first; other profiles cover representative page architectures and all breakpoint-, pointer-, or embedding-specific branches.

Every capture must retain the scenario/version hash, fixed instant and timezone, route/actions, flags, locale, browser and viewport, screenshots, DOM/accessibility state, console and failed-request evidence, trace/HAR, canonical API state and mutation log, plus video for timing-sensitive multi-step journeys. Blank and perpetual-loading legacy states are positive named assertions. A baseline is accepted only when every inventoried state family is captured or explicitly waived and two clean runs produce identical screenshot and canonical-state hashes with no undeclared network access.

This resolution specifies the evidence contract; it does not implement the harness. [Prototype the Parity Verification Harness](./10-prototype-the-parity-verification-harness.md) already owns proving that architecture, so no new ticket or fog graduation is required.
