// Test-only helper: provisions a real local D1 (workerd via wrangler's
// getPlatformProxy) with every committed migration applied, so tests can
// exercise the Live layers against actual D1 semantics instead of the
// in-memory Seed fixtures or a fake binding. Exported as the package's
// `./testing` subpath — never import this from application code.
import { join } from 'node:path'
import type { D1Database } from '@cloudflare/workers-types'
import { getPlatformProxy } from 'wrangler'
import { listMigrations } from './migrations-fs.ts'

const packageDir = join(import.meta.dirname, '..')

export type TestD1 = {
  readonly d1: D1Database
  readonly dispose: () => Promise<void>
}

/**
 * Splits a drizzle-kit migration file into executable statements.
 * drizzle-kit separates statements with `--> statement-breakpoint` markers.
 */
const splitStatements = (sql: string): readonly string[] =>
  // Assumes drizzle-kit's breakpoint marker never appears inside a SQL literal.
  sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)

/** Applies every committed migration, in name order, to the given D1. */
export const applyMigrations = async (d1: D1Database): Promise<void> => {
  for (const { sql } of listMigrations()) {
    for (const statement of splitStatements(sql)) {
      await d1.prepare(statement).run()
    }
  }
}

/**
 * Boots an isolated, non-persisted local D1 and applies all migrations.
 * Callers own the lifecycle: run once per suite (getPlatformProxy starts a
 * workerd process, ~seconds) and always `await dispose()` in afterAll.
 */
export const provisionTestD1 = async (): Promise<TestD1> => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(packageDir, 'wrangler.jsonc'),
    persist: false
  })
  await applyMigrations(proxy.env.DB)
  return {
    d1: proxy.env.DB,
    dispose: () => proxy.dispose()
  }
}
