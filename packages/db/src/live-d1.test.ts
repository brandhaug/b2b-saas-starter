import { Effect } from 'effect'
import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { provisionTestD1, type TestD1 } from './testing.ts'
import { Database, layerFromD1, batch, DbBatchError } from './index.ts'
import { apiTokens, notifications, starterModules, workspaces } from './schema.ts'

// These tests run against a real local D1 (workerd) with all committed
// migrations applied — they validate the schema and D1 semantics the Seed
// layers cannot: migration SQL correctness, column mode round-trips,
// cascade deletes, and batch atomicity.

let test: TestD1
let dbLayer: ReturnType<typeof layerFromD1>

beforeAll(async () => {
  test = await provisionTestD1()
  dbLayer = layerFromD1(test.d1)
}, 60_000)

afterAll(async () => {
  await test.dispose()
})

const run = <A, E>(effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromise(Effect.provide(effect, dbLayer))

const iso = '2026-07-03T09:00:00.000Z'

describe('migrations', () => {
  it('create every table the schema declares', async () => {
    const rows = await test.d1
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all<{ name: string }>()
    const tables = new Set(rows.results.map((row) => row.name))
    const expected = [
      'user',
      'session',
      'account',
      'verification',
      'workspaces',
      'workspace_members',
      'workspace_invitations',
      'starter_modules',
      'workspace_module_states',
      'integration_connections',
      'api_tokens',
      'webhook_endpoints',
      'webhook_deliveries',
      'implementation_reports',
      'report_schedules',
      'notifications',
      'audit_events',
      'catalog_refresh_runs'
    ]
    for (const table of expected) {
      expect(tables, `missing table ${table}`).toContain(table)
    }
  })
})

describe('column modes over live D1', () => {
  it('round-trips boolean-mode integers as JS booleans', async () => {
    const module = await run(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database.insert(starterModules).values({
          id: 'mod_bool_check',
          name: 'Boolean check',
          summary: 'boolean round-trip',
          category: 'test',
          docsPath: '/docs/test',
          optional: true
        })
        const rows = yield* database
          .select()
          .from(starterModules)
          .where(eq(starterModules.id, 'mod_bool_check'))
        return rows[0]
      })
    )
    expect(module?.optional).toBe(true)
  })

  it('round-trips JSON-mode text columns as parsed values', async () => {
    const token = await run(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database.insert(workspaces).values({
          id: 'wrk_json_check',
          slug: 'json-check',
          name: 'JSON check',
          createdAt: iso,
          updatedAt: iso
        })
        yield* database.insert(apiTokens).values({
          id: 'tok_json_check',
          workspaceId: 'wrk_json_check',
          name: 'JSON check',
          tokenPrefix: 'bsk_live_json',
          tokenHash: 'hash_json_check',
          scopes: ['read', 'write'],
          createdAt: iso
        })
        const rows = yield* database
          .select()
          .from(apiTokens)
          .where(eq(apiTokens.id, 'tok_json_check'))
        return rows[0]
      })
    )
    expect(token?.scopes).toEqual(['read', 'write'])
  })
})

describe('referential integrity over live D1', () => {
  it('cascade-deletes workspace children when the workspace is removed', async () => {
    const remaining = await run(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database.insert(workspaces).values({
          id: 'wrk_cascade',
          slug: 'cascade-check',
          name: 'Cascade check',
          createdAt: iso,
          updatedAt: iso
        })
        yield* database.insert(apiTokens).values({
          id: 'tok_cascade',
          workspaceId: 'wrk_cascade',
          name: 'Cascade token',
          tokenPrefix: 'bsk_live_casc',
          tokenHash: 'hash_cascade',
          scopes: ['read'],
          createdAt: iso
        })
        yield* database.insert(notifications).values({
          id: 'not_cascade',
          workspaceId: 'wrk_cascade',
          title: 'Cascade notification',
          message: 'gone with the workspace',
          createdAt: iso
        })
        yield* database.delete(workspaces).where(eq(workspaces.id, 'wrk_cascade'))
        const tokens = yield* database
          .select({ value: count() })
          .from(apiTokens)
          .where(eq(apiTokens.workspaceId, 'wrk_cascade'))
        const feed = yield* database
          .select({ value: count() })
          .from(notifications)
          .where(eq(notifications.workspaceId, 'wrk_cascade'))
        return { tokens: tokens[0]?.value, notifications: feed[0]?.value }
      })
    )
    expect(remaining).toEqual({ tokens: 0, notifications: 0 })
  })
})

describe('batch atomicity over live D1', () => {
  it('rolls back every statement when one fails', async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database.insert(workspaces).values({
          id: 'wrk_batch_existing',
          slug: 'batch-existing',
          name: 'Batch existing',
          createdAt: iso,
          updatedAt: iso
        })
        // Second statement violates the primary key, so the whole batch —
        // including the valid first insert — must roll back.
        const error = yield* Effect.flip(
          batch(database, [
            database.insert(workspaces).values({
              id: 'wrk_batch_new',
              slug: 'batch-new',
              name: 'Batch new',
              createdAt: iso,
              updatedAt: iso
            }),
            database.insert(workspaces).values({
              id: 'wrk_batch_existing',
              slug: 'batch-duplicate',
              name: 'Batch duplicate',
              createdAt: iso,
              updatedAt: iso
            })
          ])
        )
        const rows = yield* database
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, 'wrk_batch_new'))
        return { error, inserted: rows.length }
      })
    )
    expect(outcome.error).toBeInstanceOf(DbBatchError)
    expect(outcome.inserted).toBe(0)
  })
})
