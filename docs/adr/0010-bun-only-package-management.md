# Bun-only package management (superseded by pnpm and Vite+)

The starter uses Bun workspaces, Bun lockfiles, and the root package catalog as the only package management path. Supporting npm or pnpm in parallel would add script, lockfile, and documentation noise, while both source repositories already use Bun and Turborepo effectively.

Superseded by [0053 — pnpm and Vite+ toolchain](./0053-pnpm-and-vite-plus-toolchain.md): the repo now runs pnpm with a `pnpm-workspace.yaml` catalog, and Bun (package manager and runtime) is removed entirely.
