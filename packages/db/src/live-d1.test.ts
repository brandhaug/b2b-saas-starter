import { Context, Effect, Layer } from 'effect'
import { describe, expect, layer } from '@effect/vitest'
import { count, eq } from 'drizzle-orm'
import { provisionTestD1, type TestD1 } from './testing.ts'
import { Database, layerFromD1, batch, DbBatchError } from './index.ts'
import { apiTokens, notifications, starterModules, workspaces } from './schema.ts'

// These tests run against a real local D1 (workerd) with all committed
// migrations applied — they validate the schema and D1 semantics the Seed
// layers cannot: migration SQL correctness, column mode round-trips,
// cascade deletes, and batch atomicity.

/** The raw binding, for the migration assertions that read `sqlite_master`. */
class TestD1Binding extends Context.Service<
  TestD1Binding,
  { readonly d1: TestD1['d1'] }
>()('@b2b-saas-starter/db/test/TestD1Binding') {}

/**
 * getPlatformProxy boots a workerd process (~seconds) that the whole file
 * shares. It is acquired once and released when the test layer's scope closes,
 * so no test lifecycle hooks are needed.
 */
const TestDatabase = Layer.unwrap(
  Effect.gen(function* () {
    const provisioned = yield* Effect.acquireRelease(
      Effect.promise(() => provisionTestD1()),
      (testD1) => Effect.promise(() => testD1.dispose())
    )
    return Layer.merge(
      layerFromD1(provisioned.d1),
      Layer.succeed(TestD1Binding)({ d1: provisioned.d1 })
    )
  })
)

const iso = '2026-07-03T09:00:00.000Z'

layer(TestDatabase, { timeout: '120 seconds' })('live d1', (it) => {
  describe('migrations', () => {
    it.effect('create every table the schema declares', () =>
      Effect.gen(function* () {
        const { d1 } = yield* TestD1Binding
        const rows = yield* Effect.promise(() =>
          d1
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all<{ name: string }>()
        )
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
    )
  })

  describe('column modes over live D1', () => {
    it.effect('round-trips boolean-mode integers as JS booleans', () =>
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
        expect(rows[0]?.optional).toBe(true)
      })
    )

    it.effect('round-trips JSON-mode text columns as parsed values', () =>
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
        expect(rows[0]?.scopes).toEqual(['read', 'write'])
      })
    )
  })

  describe('referential integrity over live D1', () => {
    it.effect('cascade-deletes workspace children when the workspace is removed', () =>
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
        expect({ tokens: tokens[0]?.value, notifications: feed[0]?.value }).toEqual({
          tokens: 0,
          notifications: 0
        })
      })
    )
  })

  describe('batch atomicity over live D1', () => {
    it.effect('rolls back every statement when one fails', () =>
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
        expect(error).toBeInstanceOf(DbBatchError)
        expect(rows).toHaveLength(0)
      })
    )
  })
})
