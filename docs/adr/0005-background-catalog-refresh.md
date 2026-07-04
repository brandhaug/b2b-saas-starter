# Background catalog refresh

The starter treats Starter Module Catalog refresh as recurring operational work rather than only a local script. `apps/background` runs `runCatalogRefresh` on a daily cron trigger (`0 6 * * *`) with wide-event logging and recorded run history, and `bun run catalog:refresh` is the manual CLI entry point, currently executing against the in-memory Seed adapter.

Automation that opens pull requests for outdated entries in the root `package.json` dependency catalog is a separate concern and is not included; a previously checked-in workflow template for it was removed because it invoked the domain refresh script instead of a dependency check. If added later it belongs in GitHub Actions, next to CI.
