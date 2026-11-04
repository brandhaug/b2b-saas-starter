import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { orUnavailable } from '@b2b-saas-starter/failure/capability'
import { ApiTokenId } from './ids.ts'
import { apiTokens, webhookDeliveries } from './schema/developer-platform.ts'
import { personalDataExports } from './schema/governance.ts'
import { oauthClient } from './schema/oauth.ts'
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
    'round-trips scalar and nested JSON, SQL NULL, defaults and plugin arrays exactly once',
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        const d1 = test.d1
        const pluginDb = drizzle(d1)
        const redirectUris = ['https://example.test/callback']
        yield* Effect.promise(() =>
          pluginDb
            .insert(oauthClient)
            .values({
              id: 'plugin-codec',
              clientId: 'plugin-codec',
              redirectUris: sql.placeholder('uris'),
              metadata: { nested: [true, null, { count: 3 }] }
            })
            .prepare()
            .run({ uris: '["https://example.test/callback"]' })
        )
        yield* db.insert(oauthClient).values({
          id: 'direct-codec',
          clientId: 'direct-codec',
          redirectUris,
          metadata: 'scalar-value'
        })
        const rows = yield* db.select().from(oauthClient).orderBy(oauthClient.id)
        expect(
          rows.map((row) => ({
            uris: row.redirectUris,
            nullable: row.scopes,
            defaults: row.clientCredentialsScopes,
            metadata: row.metadata
          }))
        ).toEqual([
          {
            uris: redirectUris,
            nullable: null,
            defaults: [],
            metadata: 'scalar-value'
          },
          {
            uris: redirectUris,
            nullable: null,
            defaults: [],
            metadata: { nested: [true, null, { count: 3 }] }
          }
        ])
        const raw = yield* Effect.promise(() =>
          d1.prepare('SELECT redirectUris FROM oauth_client ORDER BY id').all()
        )
        expect(raw.results).toEqual([
          { redirectUris: '["https://example.test/callback"]' },
          { redirectUris: '["https://example.test/callback"]' }
        ])
        const pluginRows = yield* Effect.promise(() =>
          pluginDb.select().from(oauthClient).orderBy(oauthClient.id).all()
        )
        expect(pluginRows).toEqual(rows)

        const invalidWrite = yield* Effect.exit(
          Effect.suspend(() =>
            db
              .insert(oauthClient)
              .values({
                id: 'invalid-codec',
                clientId: 'invalid-codec',
                redirectUris: sql.placeholder('uris')
              })
              .prepare()
              .run({ uris: '[1,"private-secret"]' })
          ).pipe(orUnavailable('oauth'))
        )
        expect(invalidWrite).toMatchObject({
          _tag: 'Failure',
          cause: {
            reasons: [
              {
                _tag: 'Fail',
                error: { reason: 'persistence_decode:oauth.redirectUris:write' }
              }
            ]
          }
        })
        expect(
          yield* db
            .select()
            .from(oauthClient)
            .where(eq(oauthClient.id, 'invalid-codec'))
        ).toEqual([])
      }).pipe(Effect.provide(layerFromD1(test.d1)))
  )

  it.live('rejects header and conversation-manifest shapes from D1 results', () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* db
        .insert(workspaces)
        .values({ id: 'shape-source', slug: 'shape-source', name: 'Shape source' })
      const headers = yield* Effect.exit(
        db
          .select({
            value: sql`'{"authorization":42}'`.mapWith(webhookDeliveries.requestHeaders)
          })
          .from(workspaces)
          .where(eq(workspaces.id, 'shape-source'))
          .pipe(orUnavailable('headers'))
      )
      const manifest = yield* Effect.exit(
        db
          .select({
            value: sql`'[{"id":"private-secret","policyRevision":"wrong"}]'`.mapWith(
              personalDataExports.conversationManifest
            )
          })
          .from(workspaces)
          .where(eq(workspaces.id, 'shape-source'))
          .pipe(orUnavailable('manifest'))
      )
      expect(headers).toMatchObject({
        _tag: 'Failure',
        cause: {
          reasons: [
            {
              _tag: 'Fail',
              error: {
                reason: 'persistence_decode:webhook_deliveries.request_headers:read'
              }
            }
          ]
        }
      })
      expect(manifest).toMatchObject({
        _tag: 'Failure',
        cause: {
          reasons: [
            {
              _tag: 'Fail',
              error: {
                reason:
                  'persistence_decode:personal_data_exports.conversation_manifest:read'
              }
            }
          ]
        }
      })
    }).pipe(Effect.provide(layerFromD1(test.d1)))
  )

  it.live(
    'removes query text and bound credentials from actual Effect-D1 failures',
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        const result = yield* Effect.exit(
          db
            .insert(apiTokens)
            .values({
              id: ApiTokenId.make('sql-secret-test'),
              workspaceId: 'missing-parent',
              name: 'private-secret',
              tokenPrefix: 'credential-prefix',
              tokenHash: 'credential-hash',
              scopes: ['read'],
              createdAt: '2026-11-04T12:00:00.000Z'
            })
            .pipe(orUnavailable('tokens'))
        )
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          expect(result.cause.reasons).toHaveLength(1)
          expect(result.cause.reasons[0]).toMatchObject({
            _tag: 'Fail',
            error: { reason: 'persistence_sql' }
          })
        }
        // oxlint-disable-next-line effect/noGlobals -- inspect the entire serialized failure, not an allowlisted projection
        const serialized = JSON.stringify(result)
        for (const sensitive of [
          'private-secret',
          'credential-prefix',
          'credential-hash',
          'insert into',
          'params',
          'query'
        ]) {
          expect(serialized).not.toContain(sensitive)
        }
      }).pipe(Effect.provide(layerFromD1(test.d1)))
  )

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
          // oxlint-disable-next-line effect/noGlobals -- verify no rejected value survives anywhere in the serialized failure
          expect(JSON.stringify(result)).not.toContain('private-secret')
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
