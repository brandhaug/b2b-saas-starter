# Bun-only package management

The starter uses Bun workspaces, Bun lockfiles, and the root package catalog as the only package management path. Supporting npm or pnpm in parallel would add script, lockfile, and documentation noise, while both source repositories already use Bun and Turborepo effectively.
