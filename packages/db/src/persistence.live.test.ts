import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { eq, sql } from 'drizzle-orm'
import { orUnavailable } from '@b2b-saas-starter/failure/capability'
import { ApiTokenId } from './ids.ts'
import { apiTokens } from './schema/developer-platform.ts'
import { workspaces } from './schema/workspaces.ts'
import { Database, batchResults, layerFromD1 } from './service.ts'
import { provisionTestD1, type TestD1 } from './testing.ts'

let test: TestD1
// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the isolated workerd process
beforeAll(
  () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- owns workerd setup outside a test effect
    Effect.runPromise(
      Effect.gen(function* () {
        test = yield* Effect.promise(() => provisionTestD1())
      })
    ),
  60_000
)
// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the isolated workerd process
afterAll(() => test.dispose())

describe('validated stored JSON', () => {
  it.live(
    'rejects malformed scopes through the typed channel without retaining payloads',
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        const d1 = test.d1
        yield* db
          .insert(workspaces)
          .values({ id: 'codec-workspace', name: 'Codec', slug: 'codec-workspace' })
        const id = ApiTokenId.make('codec-token')
        yield* db.insert(apiTokens).values({
          id,
          workspaceId: 'codec-workspace',
          name: 'Codec',
          tokenPrefix: 'test',
          tokenHash: 'codec-hash',
          scopes: ['read'],
          createdAt: '2026-11-04T12:00:00.000Z'
        })
        for (const stored of [
          '{"private-secret":',
          '{"private-secret":true}',
          '["private-secret"]'
        ]) {
          yield* Effect.promise(() =>
            d1
              .prepare('UPDATE api_tokens SET scopes = ? WHERE id = ?')
              .bind(stored, id)
              .run()
          )
          const result = yield* Effect.exit(
            db
              .select()
              .from(apiTokens)
              .where(eq(apiTokens.id, id))
              .pipe(orUnavailable('tokens'))
          )
          expect(result).toMatchObject({
            _tag: 'Failure',
            cause: {
              reasons: [
                {
                  _tag: 'Fail',
                  error: {
                    _tag: 'CapabilityUnavailable',
                    reason: 'persistence_decode:api_tokens.scopes:read'
                  }
                }
              ]
            }
          })
        }
      }).pipe(Effect.provide(layerFromD1(test.d1)))
  )

  it.live(
    'keeps batch result order, change counts and atomic rollback with sanitized errors',
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        const results = yield* batchResults([
          db
            .insert(workspaces)
            .values({ id: 'batch-codec', slug: 'batch-codec', name: 'Before' }),
          db
            .update(workspaces)
            .set({ name: 'After' })
            .where(eq(workspaces.id, 'batch-codec')),
          db
            .select({ changes: sql<number>`changes()`.as('changes') })
            .from(workspaces)
            .where(eq(workspaces.id, 'batch-codec'))
        ])
        expect(results[0]?.meta.changes).toBe(1)
        expect(results[1]?.meta.changes).toBe(1)
        expect(results[2]?.results).toEqual([{ changes: 1 }])
        const failed = yield* Effect.exit(
          batchResults([
            db
              .update(workspaces)
              .set({ name: 'private-secret' })
              .where(eq(workspaces.id, 'batch-codec')),
            db
              .insert(workspaces)
              .values({ id: 'batch-codec', slug: 'duplicate', name: 'Duplicate' })
          ]).pipe(orUnavailable('batch'))
        )
        expect(failed).toMatchObject({
          _tag: 'Failure',
          cause: { reasons: [{ _tag: 'Fail', error: { reason: 'persistence_sql' } }] }
        })
        expect(
          (yield* db
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, 'batch-codec')))[0]?.name
        ).toBe('After')
      }).pipe(Effect.provide(layerFromD1(test.d1)))
  )
})
