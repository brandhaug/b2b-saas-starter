# CI with manual Alchemy deploy

The starter includes GitHub Actions for CI and dependency catalog updates, but not automatic production deployment by default. Deploys should run through documented `bun run deploy` Alchemy commands so teams intentionally configure Cloudflare accounts, secrets, and project identifiers before enabling any automated deploy workflow.
