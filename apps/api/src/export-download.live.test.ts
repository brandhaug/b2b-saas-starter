import { createHmac } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { expect, layer } from '@effect/vitest'
import { DateTime, Effect, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { Database } from '@b2b-saas-starter/db/service'
import { workspaceExports, workspaceMembers } from '@b2b-saas-starter/db/schema'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import {
  WorkspaceExports,
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestD1,
  TestDatabase
} from '@b2b-saas-starter/capabilities/testing/live-harness'
import { buildWebHandler } from './http.ts'
import { jsonBody } from './test-utils.ts'

function exportStorage() {
  const objects = new Map<string, Uint8Array>()
  const queue: WorkspaceExportQueueBinding = { send: () => Promise.resolve() }
  const bucket: WorkspaceExportBucketBinding = {
    put: (key, bytes) => {
      objects.set(key, new Uint8Array(bytes))
      return Promise.resolve()
    },
    get: (key) => {
      const bytes = objects.get(key)
      if (!bytes) {
        return Promise.resolve(null)
      }
      const copy = new ArrayBuffer(bytes.length)
      new Uint8Array(copy).set(bytes)
      return Promise.resolve({
        size: bytes.length,
        arrayBuffer: () => Promise.resolve(copy)
      })
    }
  }
  return { queue, bucket, objects }
}

const DownloadLink = Schema.Struct({ url: Schema.String })
const allow = { limit: () => Promise.resolve({ success: true }) }
const suspensionActions: ReadonlyArray<'suspend' | 'unsuspend'> = [
  'suspend',
  'unsuspend'
]

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT, excludeTestServices: true })(
  'Live signed export downloads',
  (it) => {
    // The HTTP handler owns a live runtime. Mint and validate its links using
    // the same wall clock; expired signatures below use a fixed past instant.
    it.effect(
      'links bind one artifact and recheck expiry, suspension and issuing credentials',
      () =>
        Effect.gen(function* () {
          const DB = yield* TestD1
          const db = yield* Database
          yield* db.insert(workspaceMembers).values({
            id: 'mem_download_other',
            workspaceId: 'wrk_other',
            userId: 'usr_outsider',
            role: 'owner'
          })
          const storage = exportStorage()
          const bindings = { workspaceExports: storage }
          const env = {
            DB,
            WORKSPACE_EXPORT_QUEUE: storage.queue,
            WORKSPACE_EXPORT_BUCKET: storage.bucket,
            RATE_LIMITER_REST_READ: allow,
            RATE_LIMITER_REST_WRITE: allow
          }
          const server = yield* Effect.acquireRelease(
            Effect.sync(() => buildWebHandler(env)),
            (current) => Effect.promise(() => current.dispose())
          )
          function request(path: string, token?: string) {
            const init: RequestInit = { method: 'GET' }
            if (token !== undefined) {
              init.method = 'POST'
              init.headers = {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json'
              }
              init.body = '{}'
            }
            return Effect.promise(() =>
              server.handler(new Request(new URL(path, 'https://api.test'), init))
            )
          }
          const archiveA = new Uint8Array(gzipSync('Workspace A private data'))
          const archiveB = new Uint8Array(gzipSync('Workspace B private data'))
          const fixtures = [
            {
              id: 'wrk_live',
              slug: 'live-lab',
              userId: 'usr_owner',
              archive: archiveA
            },
            {
              id: 'wrk_other',
              slug: 'other-lab',
              userId: 'usr_outsider',
              archive: archiveB
            }
          ]
          const completed = []
          for (const workspace of fixtures) {
            completed.push(
              yield* inWorkspace(
                workspace.slug,
                Effect.gen(function* () {
                  const tokens = yield* ApiTokenRegistry
                  const token = yield* tokens.create({
                    name: 'Export authority',
                    scopes: ['admin']
                  })
                  const exports = yield* WorkspaceExports
                  const job = yield* exports.request
                  expect(
                    yield* exports.complete({
                      exportId: job.id,
                      workspaceId: workspace.id,
                      archive: workspace.archive
                    })
                  ).toBe(true)
                  return { ...workspace, job, token }
                }),
                { userId: workspace.userId },
                bindings
              )
            )
          }
          const a = completed[0]
          const b = completed[1]
          if (!a || !b) {
            return yield* Effect.die('expected two completed exports')
          }
          const pathA = `/workspaces/${a.slug}/exports/${a.job.id}/download-link`
          const pathB = `/workspaces/${b.slug}/exports/${b.job.id}/download-link`
          const issueA = yield* request(pathA, a.token.token)
          const issueB = yield* request(pathB, b.token.token)
          expect(issueA.status).toBe(200)
          expect(issueB.status).toBe(200)
          const linkA = yield* jsonBody(issueA, DownloadLink)
          const linkB = yield* jsonBody(issueB, DownloadLink)
          for (const { url, archive } of [
            { url: linkA.url, archive: archiveA },
            { url: linkB.url, archive: archiveB }
          ]) {
            const response = yield* request(url)
            expect(response.status).toBe(200)
            expect(response.headers.get('cache-control')).toBe('private, no-store')
            expect(
              new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()))
            ).toEqual(archive)
          }
          expect(
            (yield* request(
              `/workspaces/${a.slug}/exports/${b.job.id}/download-link`,
              a.token.token
            )).status
          ).toBe(404)
          expect((yield* request(pathB, a.token.token)).status).toBe(403)
          const substituted = new URL(linkA.url)
          substituted.pathname = `/exports/${b.job.id}/download`
          const tampered = new URL(linkA.url)
          tampered.searchParams.set(
            'expires',
            String(Number(tampered.searchParams.get('expires')) + 1)
          )
          const rows = yield* db
            .select({ secret: workspaceExports.downloadSecret })
            .from(workspaceExports)
            .where(eq(workspaceExports.id, a.job.id))
          const row = rows[0]
          if (!row) {
            return yield* Effect.die('expected the export signing secret')
          }
          const expired = new URL(linkA.url)
          const expires = 1
          expired.searchParams.set('expires', String(expires))
          expired.searchParams.set(
            'signature',
            createHmac('sha256', row.secret)
              .update(`${a.job.id}.${expires}`)
              .digest('hex')
          )
          for (const url of [
            substituted.href,
            tampered.href,
            expired.href,
            `/exports/${a.job.id}/download`,
            '/exports/missing/download?expires=1&signature=invalid'
          ]) {
            const response = yield* request(url)
            expect(response.status).toBe(404)
            expect(yield* Effect.promise(() => response.text())).toBe('')
          }
          yield* inWorkspace(
            a.slug,
            Effect.flatMap(ApiTokenRegistry, (tokens) =>
              tokens.revoke({ tokenId: a.token.id })
            ),
            { userId: a.userId },
            bindings
          )
          expect((yield* request(pathA, a.token.token)).status).toBe(401)
          // A minted URL is an independent bearer credential until its expiry.
          expect((yield* request(linkA.url)).status).toBe(200)
          for (const action of suspensionActions) {
            yield* inWorkspace(
              a.slug,
              Effect.flatMap(WorkspaceSuspensionService, (suspension) =>
                suspension.transition({
                  workspaceId: a.id,
                  action,
                  actor: { userId: 'usr_sysadmin' },
                  internalReason: 'Download test',
                  customerExplanation: 'Test workspace paused'
                })
              ),
              undefined,
              bindings
            )
            const response = yield* request(linkA.url)
            if (action === 'suspend') {
              expect(response.status).toBe(404)
              expect(yield* Effect.promise(() => response.text())).toBe('')
            } else {
              expect(response.status).toBe(200)
            }
            expect((yield* request(linkB.url)).status).toBe(200)
          }
          const now = yield* DateTime.now
          yield* db
            .update(workspaceExports)
            .set({
              expiresAt: DateTime.formatIso(DateTime.subtractDuration(now, '1 second'))
            })
            .where(eq(workspaceExports.id, a.job.id))
          expect((yield* request(linkA.url)).status).toBe(404)
          // Expiry is enforced before the physical R2 object is removed.
          expect(storage.objects.size).toBe(2)
        })
    )
  }
)
