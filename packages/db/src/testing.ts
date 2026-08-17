// Test-only helper: provisions a real local D1 (workerd via wrangler's
// getPlatformProxy) with every committed migration applied, so tests can
// exercise the Live layers against actual D1 semantics instead of the
// in-memory Seed fixtures or a fake binding. Exported as the package's
// `./testing` subpath — never import this from application code.
//
// The exported surface stays promise-based on purpose: it wraps wrangler's
// promise API and is consumed from plain vitest lifecycle hooks. The work
// itself runs as an Effect and is converted once, at that boundary.
// oxlint-disable effect/noNodeBuiltinImport -- wrangler needs a filesystem config path
import { join } from 'node:path'
import { Effect } from 'effect'
import { type D1Database } from '@cloudflare/workers-types'
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
function splitStatements(sql: string): readonly string[] {
  // Assumes drizzle-kit's breakpoint marker never appears inside a SQL literal.
  return sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

const applyMigrationsEffect = Effect.fn('TestD1.applyMigrations')(function* (
  d1: D1Database
) {
  for (const { sql } of listMigrations()) {
    for (const statement of splitStatements(sql)) {
      yield* Effect.promise(() => d1.prepare(statement).run())
    }
  }
})

/** Applies every committed migration, in name order, to the given D1. */
export function applyMigrations(d1: D1Database): Promise<void> {
  return Effect.runPromise(applyMigrationsEffect(d1))
}

const provisionTestD1Effect = Effect.gen(function* () {
  const proxy = yield* Effect.promise(() =>
    getPlatformProxy<{ DB: D1Database }>({
      configPath: join(packageDir, 'wrangler.jsonc'),
      persist: false
    })
  )
  yield* applyMigrationsEffect(proxy.env.DB)
  return {
    d1: proxy.env.DB,
    dispose: () => proxy.dispose()
  }
})

/**
 * Boots an isolated, non-persisted local D1 and applies all migrations.
 * Callers own the lifecycle: run once per suite (getPlatformProxy starts a
 * workerd process, ~seconds) and always `await dispose()` in afterAll.
 */
export function provisionTestD1(): Promise<TestD1> {
  return Effect.runPromise(provisionTestD1Effect)
}
