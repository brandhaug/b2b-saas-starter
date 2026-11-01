# Dependency feature adoption

## Agreed scope

Adopt the recommendations in [the six-month audit](dependency-features-2026-11-01.md). The user requested full implementation delivered as stacked pull requests. The ten ranked recommendations are required. Resolve the audit's concrete operational follow-ups and assess optional experiments using actual compatibility and measurements, retaining explicit decisions where a feature lacks a starter use case.

## Stack and acceptance

1. Tooling: enable static Paraglide access linting, move local rule helpers to Vite+ exports, update Effect lint rules selectively, remove diagnostic-confirmed Fallow exceptions, and add non-blocking health reporting. Resolve the pnpm Action pin, update Trivy, and assess remaining toolchain/Action follow-ups. Preserve supported runtimes and reproducible installs.
2. Web and email: replace CDP passkey setup with Playwright Credentials while preserving authenticator behavior; exercise browser coverage. Localize toast accessible labels through the application boundary. Adopt email theme/preview features with representative preview inputs. Assess optional web experiments from the audit against concrete utility and measured results.
3. API: scope MCP discovery to current request authority without weakening execution checks. Adopt RFC 9457 consistently for the public REST error boundary, with safe details, clients/OpenAPI and regression checks. Preserve capability ownership, Worker compatibility and authorization invariants.

Each layer requires its relevant checks and reviews; the integrated stack requires `pnpm run check` and `pnpm run validate`. Write repeatable evidence with commands, observed outcomes and remaining blockers. Changes must not duplicate already-adopted features or invent provider requirements. Save an adoption disposition for every ranked recommendation and optional follow-up.

## Review ownership

The main session alone dispatches reviews, makes commits, publishes the PR stack, and watches CI. Implementation workers own only their assigned file boundaries. They must not dispatch reviewers, commit, push, open PRs, or modify shared dependency manifests, lockfiles, root lint config, or this plan without coordination.
