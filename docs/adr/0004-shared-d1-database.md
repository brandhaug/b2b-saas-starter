# Shared D1 database

The starter uses one shared Cloudflare D1 database for the web worker, API worker, background worker (catalog refresh and webhook delivery), Better Auth tables, workspace data, starter modules, integration surfaces, and implementation reports. Schema and migrations live in `packages/db`; separate databases are deferred until a module boundary has a real operational reason to own its own persistence.
