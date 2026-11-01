# Persisted local D1 in development and end-to-end tests

Alchemy owns both development and deployment bindings through `alchemy.run.ts`.
Development uses local state, runs the web server through `Website.Vite` with
HMR, and runs API/background Workers with the same D1, queue and Durable Object
declarations as deployment. The startup wrapper prepares translations and a
stable demo SQL import; Alchemy applies migrations and imports changed seed SQL.
Data persists in `.alchemy/local`, so a restart does not reset edited records.

The compiled Node E2E preview retains a separate Miniflare companion Worker and
database under `packages/db/.wrangler/state/v3`. This avoids Vite transforms
during the full browser suite. A focused browser suite also exercises native
Alchemy development from a clean checkout. Isolated tests and standalone builds
use the inert shim; Alchemy supplies native server bindings and an inert browser
shim. No generated app Wrangler configurations are needed.

This keeps HMR while exercising Better Auth against real tables and removes
parallel local/deployed binding assembly. The demo identity must agree across
Seed and D1 because client navigation and server loads can use different
adapters. Development and compiled-preview storage are separate; reset procedures
live in [setup](../setup.md#database).
