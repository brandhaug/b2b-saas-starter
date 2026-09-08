# Ephemeral pull-request previews

Same-repository pull requests receive an isolated Alchemy stage with their own worker and data resources. Deployment uses the normal infrastructure definition and seed script; closing the PR destroys the stage. This permits concurrent review of schema changes without sharing production data or a mutable staging environment.

Previews omit optional providers and use demo data. Fork and Dependabot code cannot run the secret-bearing workflow. The [preview workflow](../../.github/workflows/preview.yml) owns triggers, credentials, and cleanup; [ADR 0019](./0019-ci-with-alchemy-deploy-on-merge.md) owns production deployment.
