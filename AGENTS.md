# B2B SaaS Starter

Cloudflare-first B2B SaaS starter. The public site showcases the repository itself; the authenticated app is a reference implementation for workspaces, members/RBAC, API/MCP, email, webhooks, notifications, audit, and admin.

See [CONTEXT.md](./CONTEXT.md) for canonical domain language, [ARCHITECTURE.md](./ARCHITECTURE.md) for the system map and security model, and [DESIGN.md](./DESIGN.md) for the visual identity — design tokens, typography, and component contracts. Decisions live in [docs/adr](./docs/adr).

## Project posture

Nothing here is in production use. Refactor freely, rename what reads wrong, and drop stored shapes rather than migrating them — no backwards compatibility, no deprecation path, no compatibility shims for old data.

## Intent Node Index

| Area              | Intent Node                                                          |
| ----------------- | -------------------------------------------------------------------- |
| Web app           | [apps/web/AGENTS.md](apps/web/AGENTS.md)                             |
| API worker        | [apps/api/AGENTS.md](apps/api/AGENTS.md)                             |
| Background worker | [apps/background/AGENTS.md](apps/background/AGENTS.md)               |
| Database          | [packages/db/AGENTS.md](packages/db/AGENTS.md)                       |
| Capabilities      | [packages/capabilities/AGENTS.md](packages/capabilities/AGENTS.md)   |
| Authentication    | [packages/auth/AGENTS.md](packages/auth/AGENTS.md)                   |
| Authorization     | [packages/authz/AGENTS.md](packages/authz/AGENTS.md)                 |
| Observability     | [packages/logger/AGENTS.md](packages/logger/AGENTS.md)               |
| Typed SDK         | [packages/sdk/AGENTS.md](packages/sdk/AGENTS.md)                     |
| Lint rules        | [packages/oxlint-plugin/AGENTS.md](packages/oxlint-plugin/AGENTS.md) |

Capabilities are grouped into bounded-context folders under `packages/capabilities/src/`: `developer-platform/`, `governance/`, `notifications/`. Each capability has a leaf intent node beside its source file — see the package node for the map and the "Where to put a new capability" rules.

## Setup

Requires the [Vite+ CLI](https://viteplus.dev) (`vp`, >= 0.3.0) — it provides
the managed Node runtime and the pnpm version pinned in `package.json`.

```bash
vp install
pnpm run dev
pnpm run build
pnpm run test
```

- Web dev server: `http://localhost:3071`
- API worker dev server: `pnpm -C apps/api dev`
- Background worker dev server: `pnpm -C apps/background dev`
- Package manager: pnpm only (pin in `packageManager`, catalog in
  `pnpm-workspace.yaml`)
- Task runner: Vite Task (`vp run`), not Turbo
- Formatting: `vp fmt` (Oxfmt)
- Linting: `vp lint` (Oxlint, type-aware)

**Validation requirement.** The pre-commit hook only formats staged files — it
does not gate commits. Run `pnpm run check` (typecheck + lint + format:check +
dead-code + test) before you commit; the PR Gate workflow enforces the same bar
in CI.

## Dependencies

- Versions are single-sourced in the `catalog` block of `pnpm-workspace.yaml`.
  When adding or upgrading a dependency, add it to the catalog and reference it
  with `"catalog:"` so the workspace resolves the shared version instead of
  pinning one.
- Toolchain versions (`vite`, `vitest`, `oxlint`, `oxfmt`) are pinned by the
  local `vite-plus` package — do not bump them in the catalog by hand; they move
  with `vp upgrade` (`vp toolchain` shows the bundled versions).

## Cross-Cutting Rules

1. Use Effect v4 typed errors, services, schemas, and HTTP API contracts for application behavior.
2. Use `packages/capabilities` for business use cases; route handlers and UI components should not duplicate behavior.
3. Keep local development provider-light. Optional providers must stay inactive when their env vars are unset instead of failing the app.
4. Use Cloudflare-first primitives: Workers, D1, Queues, Email, Turnstile, Workers AI, and Alchemy.
5. Borrow interaction and visual patterns from other products freely, but never import their domain language — every behavior here is expressed through this starter's own capabilities.
6. Do not adopt architecture (games, PWA, realtime, Durable Objects) without a concrete starter use case — complexity needs a reason in this repo, not a precedent elsewhere.
7. Put every declaration merge (`declare module`, same-name interface merges) in a `.d.ts` file. Match the augmentation to the file: `declare module 'x'` needs a top-level import so the file is a module, while `declare global` and `declare namespace` need the file to have none. Elsewhere `consistent-type-definitions` rewrites `interface` to `type`. Two lint rules enforce this now (`starter/no-interface-merge-outside-dts`, `starter/no-mismatched-augmentation-context`); see `apps/web/src/router-register.d.ts` for the module case and `apps/web/src/worker-env.d.ts` for the global one. `vp lint --fix` does not run in a hook any more, so run `pnpm run check:fix` deliberately and re-run `pnpm run check` after it.

## Commit & Release Conventions

- **All commits and PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/)**: `type(scope): subject`, where `type` is one of `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`. Use `!` or a `BREAKING CHANGE:` footer for breaking changes.
- This convention is enforced by the **PR Gate** workflow (`.github/workflows/pr-gate.yml`), which fails any PR whose title does not conform.
- Releases are automated by [release-please](https://github.com/googleapis/release-please-action): merging Conventional Commits to `master` opens a release PR titled `chore(master): release ...`; merging it tags and publishes the release.
- `CLAUDE.md` is a symlink to this file so Claude Code reads the same conventions.
