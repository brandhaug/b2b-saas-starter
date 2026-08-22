# Shared D1 database

> **Amended 2026-08-22:** The implementation-reports and integration-connections tables were removed in the feature-pruning sweep (issue #103); the one-database decision itself is unchanged.

The starter uses one shared Cloudflare D1 database for the web worker, API worker, background worker (webhook delivery), Better Auth tables, and workspace data. Schema and migrations live in `packages/db`; separate databases are deferred until a capability boundary has a real operational reason to own its own persistence.
