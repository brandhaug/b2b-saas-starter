# CI with manual Alchemy deploy

The starter includes GitHub Actions for CI, but not automatic production deployment. CI runs typecheck, lint, format check, unit tests behind a coverage ratchet, a dependency audit gate, and build, then migrates and seeds the local D1 before the Playwright e2e job. The deploy job triggers only on manual `workflow_dispatch` and runs the documented `bun run deploy` Alchemy command, so teams intentionally configure Cloudflare accounts, secrets, and project identifiers before enabling any automated deploy workflow.
