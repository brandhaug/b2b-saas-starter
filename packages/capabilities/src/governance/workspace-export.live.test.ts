import { DateTime, Effect, Layer, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, layer } from '@effect/vitest'

import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import { WorkspaceSuspended, WorkspaceNotFound } from '../errors.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { AuditEventLog } from './audit-event-log.ts'
import {
  WorkspaceExportGeneration,
  WorkspaceExportGenerationLayer
} from './workspace-export-generation.ts'
import {
  WorkspaceExports,
  WORKSPACE_EXPORT_RETENTION_DAYS,
  type WorkspaceExportsInterface,
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding,
  type WorkspaceExportQueueMessage
} from './workspace-export.ts'
import { WorkspaceMembership } from './workspace-membership.ts'
import { WorkspaceSuspensionService } from './workspace-suspension.ts'
import { workspaceExportContractCases } from './workspace-export.contract.ts'

/**
 * Stub queue and bucket: the Live adapter's platform ports, in memory. The
 * queue records what was enqueued; the bucket is a `Map` the download path
 * reads back from. Together they let the whole request → complete → download
 * lifecycle run against a real D1 without Cloudflare.
 */
function stubPorts(options: { readonly failPut?: boolean } = {}) {
  const sent: Array<WorkspaceExportQueueMessage> = []
  const objects = new Map<string, Uint8Array>()
  const queue: WorkspaceExportQueueBinding = {
    send: (message) => {
      sent.push(message)
      return Promise.resolve()
    }
  }
  const bucket: WorkspaceExportBucketBinding = {
    put: (key, value) => {
      if (options.failPut) {
        return Promise.reject(new Error('bucket unavailable'))
      }
      objects.set(key, value)
      return Promise.resolve()
    },
    get: (key) => {
      const found = objects.get(key)
      if (found === undefined) {
        return Promise.resolve(null)
      }
      // A fresh ArrayBuffer copy, as R2 hands back — never the Map's own storage.
      const copy = new ArrayBuffer(found.length)
      new Uint8Array(copy).set(found)
      return Promise.resolve({
        size: found.length,
        arrayBuffer: () => Promise.resolve(copy)
      })
    }
  }
  return { sent, objects, workspaceExports: { queue, bucket } }
}

const archive = new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3])

function linkParams(path: string) {
  const url = new URL(path, 'https://api.test')
  return {
    expires: Number(url.searchParams.get('expires')),
    signature: url.searchParams.get('signature') ?? ''
  }
}

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('live workspace exports', (it) => {
  describe('unconfigured', () => {
    it.effect('reports unavailable and refuses a request without the bindings', () =>
      Effect.gen(function* () {
        const availability = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.availability)
        )
        expect(availability.available).toBe(false)
        const refused = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => Effect.flip(exports.request)),
          { userId: 'usr_owner' }
        )
        expect(refused).toMatchObject({
          _tag: 'CapabilityUnavailable',
          capability: 'workspace-exports',
          reason: 'not_configured'
        })
      })
    )
  })

  // The Seed half of this same list runs in `workspace-export.test.ts`.
  describe('live workspace export contract', () => {
    for (const contractCase of workspaceExportContractCases(expect)) {
      it.effect(contractCase.name, () =>
        inWorkspace(
          'live-lab',
          contractCase.assert,
          { userId: 'usr_owner' },
          { workspaceExports: stubPorts().workspaceExports }
        )
      )
    }
  })

  describe('lifecycle', () => {
    it.effect('refuses issue and open exactly at the artifact cutoff', () =>
      Effect.gen(function* () {
        const fixedNow = DateTime.makeUnsafe('2026-09-01T10:00:00.000Z')
        yield* TestClock.setTime(DateTime.toEpochMillis(fixedNow))
        const ports = stubPorts()
        const bindings = { workspaceExports: ports.workspaceExports }
        const requested = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.request),
          { userId: 'usr_owner' },
          bindings
        )
        yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.complete({
              exportId: requested.id,
              workspaceId: 'wrk_live',
              archive
            })
          ),
          undefined,
          bindings
        )
        const link = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.issueDownloadLink({
              recipient: { type: 'api_token' },
              exportId: requested.id
            })
          ),
          { userId: 'usr_owner' },
          bindings
        )
        if (Option.isNone(link)) {
          expect.fail('expected a link before the artifact cutoff')
          return
        }
        const params = linkParams(link.value.path)
        const cutoff = DateTime.addDuration(
          fixedNow,
          `${WORKSPACE_EXPORT_RETENTION_DAYS} days`
        )
        yield* TestClock.setTime(DateTime.toEpochMillis(cutoff))
        expect(
          Option.isNone(
            yield* inWorkspace(
              'live-lab',
              Effect.flatMap(WorkspaceExports, (exports) =>
                exports.issueDownloadLink({
                  recipient: { type: 'api_token' },
                  exportId: requested.id
                })
              ),
              { userId: 'usr_owner' },
              bindings
            )
          )
        ).toBe(true)
        expect(
          Option.isNone(
            yield* inWorkspace(
              'live-lab',
              Effect.flatMap(WorkspaceExports, (exports) =>
                exports.openDownload({ exportId: requested.id, ...params })
              ),
              undefined,
              bindings
            )
          )
        ).toBe(true)
        // Physical R2 cleanup is independent from the public validity cutoff.
        expect(ports.objects.has(`workspaces/wrk_live/${requested.id}.json.gz`)).toBe(
          true
        )
      })
    )

    it.effect('requests, completes, links, downloads, and audits an export', () =>
      Effect.gen(function* () {
        const ports = stubPorts()
        const bindings = { workspaceExports: ports.workspaceExports }

        const requested = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.request),
          { userId: 'usr_owner' },
          bindings
        )
        expect(requested.status).toBe('pending')
        expect(ports.sent).toEqual([
          {
            exportId: requested.id,
            workspaceId: 'wrk_live',
            workspaceSlug: 'live-lab',
            // `request` opens the span the publisher stamps onto the message,
            // so the consumer joins the trace (ADR 0050).
            traceparent: expect.any(String)
          }
        ])

        // Nothing to hand out while the job is pending.
        const early = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.issueDownloadLink({
              recipient: { type: 'api_token' },
              exportId: requested.id
            })
          ),
          undefined,
          bindings
        )
        expect(Option.isNone(early)).toBe(true)

        // The background half: the generation workflow resolves the context,
        // snapshots through the real capability adapters, and completes the row.
        const generated = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExportGeneration, (generation) =>
            generation.generate({
              message: {
                exportId: requested.id,
                workspaceId: 'wrk_live',
                workspaceSlug: 'live-lab'
              },
              finalAttempt: false
            })
          ).pipe(
            Effect.provide(
              WorkspaceExportGenerationLayer((slug) =>
                testWorkspaceContext({
                  id: 'wrk_live',
                  slug,
                  name: 'Live Lab',
                  planId: 'team'
                })
              )
            )
          ),
          undefined,
          bindings
        )
        expect(generated._tag).toBe('ready')
        expect([...ports.objects.keys()]).toEqual([
          `workspaces/wrk_live/${requested.id}.json.gz`
        ])
        // A second completion finds no pending row and writes nothing more.
        const again = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.complete({
              exportId: requested.id,
              workspaceId: 'wrk_live',
              archive
            })
          ),
          undefined,
          bindings
        )
        expect(again).toBe(false)

        const listed = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.list),
          undefined,
          bindings
        )
        const ready = listed.find((row) => row.id === requested.id)
        expect(ready).toMatchObject({ status: 'ready' })
        expect(ready?.sizeBytes).toBeGreaterThan(0)
        // The artifact's shelf life is a literal, not a rounding of one:
        // exactly `WORKSPACE_EXPORT_RETENTION_DAYS` past the completion the
        // row records. `not.toBeNull()` would pass for any date at all.
        expect(ready?.expiresAt).toBe(
          DateTime.formatIso(
            DateTime.addDuration(
              DateTime.makeUnsafe(ready?.completedAt ?? ''),
              `${WORKSPACE_EXPORT_RETENTION_DAYS} days`
            )
          )
        )

        // The requester was notified.
        const notifications = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(NotificationFeed, (feed) => feed.list),
          { userId: 'usr_owner' },
          bindings
        )
        expect(
          notifications.some((row) => row.title === 'Workspace export ready')
        ).toBe(true)

        const link = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.issueDownloadLink({
              recipient: { type: 'api_token' },
              exportId: requested.id
            })
          ),
          { userId: 'usr_owner' },
          bindings
        )
        if (Option.isNone(link)) {
          expect.fail('expected a download link')
        }
        const params = linkParams(link.value.path)

        const download = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.openDownload({ exportId: requested.id, ...params })
          ),
          undefined,
          bindings
        )
        if (Option.isNone(download)) {
          expect.fail('expected the archive')
        }
        expect(download.value.fileName).toBe(`live-lab-export-${requested.id}.json.gz`)
        expect([...download.value.body.subarray(0, 2)]).toEqual([0x1f, 0x8b])
        expect(download.value.sizeBytes).toBe(ready?.sizeBytes)

        const tampered = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.openDownload({
              exportId: requested.id,
              expires: params.expires + 1,
              signature: params.signature
            })
          ),
          undefined,
          bindings
        )
        expect(Option.isNone(tampered)).toBe(true)

        // Another workspace's context cannot mint a link for it.
        const foreign = yield* inWorkspace(
          'other-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.issueDownloadLink({
              recipient: { type: 'api_token' },
              exportId: requested.id
            })
          ),
          undefined,
          bindings
        )
        expect(Option.isNone(foreign)).toBe(true)

        const events = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(AuditEventLog, (log) => log.list()),
          undefined,
          bindings
        )
        const forExport = events.items
          .filter((event) => event.targetId === requested.id)
          .map((event) => event.eventType)
          .toSorted()
        expect(forExport).toEqual([
          'workspace.export_completed',
          'workspace.export_downloaded',
          'workspace.export_requested'
        ])
        expect(
          events.items.find(
            (event) =>
              event.targetId === requested.id &&
              event.eventType === 'workspace.export_completed'
          )?.actorType
        ).toBe('system')
        expect(
          events.items.find(
            (event) =>
              event.targetId === requested.id &&
              event.eventType === 'workspace.export_downloaded'
          )?.actorType
        ).toBe('api_token')
      })
    )

    it.effect(
      'settles a resolver workspace mismatch instead of completing the row',
      () =>
        Effect.gen(function* () {
          const ports = stubPorts()
          const bindings = { workspaceExports: ports.workspaceExports }
          const requested = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(WorkspaceExports, (exports) => exports.request),
            { userId: 'usr_owner' },
            bindings
          )
          const generated = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(WorkspaceExportGeneration, (generation) =>
              generation.generate({
                message: {
                  exportId: requested.id,
                  workspaceId: 'wrk_live',
                  workspaceSlug: 'live-lab'
                },
                finalAttempt: true
              })
            ).pipe(
              Effect.provide(
                WorkspaceExportGenerationLayer((slug) =>
                  testWorkspaceContext({
                    id: 'wrk_recreated',
                    slug,
                    name: 'Recreated Live Lab',
                    planId: 'team'
                  })
                )
              )
            ),
            undefined,
            bindings
          )
          expect(generated).toEqual({
            _tag: 'skipped',
            reason: 'workspace_mismatch'
          })
          const listed = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(WorkspaceExports, (exports) => exports.list),
            undefined,
            bindings
          )
          expect(listed.find((row) => row.id === requested.id)).toMatchObject({
            status: 'failed',
            failureReason: 'workspace_mismatch'
          })
          expect(ports.objects.size).toBe(0)
        })
    )

    it.effect('settles an unknown resolver workspace as a failed export', () =>
      Effect.gen(function* () {
        const ports = stubPorts()
        const bindings = { workspaceExports: ports.workspaceExports }
        const requested = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.request),
          { userId: 'usr_owner' },
          bindings
        )
        const generated = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExportGeneration, (generation) =>
            generation.generate({
              message: {
                exportId: requested.id,
                workspaceId: 'wrk_live',
                workspaceSlug: 'deleted-lab'
              },
              finalAttempt: false
            })
          ).pipe(
            Effect.provide(
              WorkspaceExportGenerationLayer((slug) =>
                Layer.unwrap(Effect.fail(new WorkspaceNotFound({ slug })))
              )
            )
          ),
          undefined,
          bindings
        )
        expect(generated).toEqual({
          _tag: 'skipped',
          reason: 'workspace_not_found'
        })
        const listed = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.list),
          undefined,
          bindings
        )
        expect(listed.find((row) => row.id === requested.id)).toMatchObject({
          status: 'failed',
          failureReason: 'workspace_not_found'
        })
      })
    )

    it.effect('settles suspension before snapshot without writing an artifact', () =>
      Effect.gen(function* () {
        const ports = stubPorts()
        const bindings = { workspaceExports: ports.workspaceExports }
        const requested = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.request),
          { userId: 'usr_owner' },
          bindings
        )
        yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceSuspensionService, (suspension) =>
            suspension.transition({
              workspaceId: 'wrk_live',
              action: 'suspend',
              actor: { userId: 'usr_sysadmin' },
              internalReason: 'generation test',
              customerExplanation: 'Exports are paused.'
            })
          )
        )
        const generated = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExportGeneration, (generation) =>
            generation.generate({
              message: {
                exportId: requested.id,
                workspaceId: 'wrk_live',
                workspaceSlug: 'live-lab'
              },
              finalAttempt: true
            })
          ).pipe(
            Effect.provide(
              WorkspaceExportGenerationLayer((slug) =>
                testWorkspaceContext({
                  id: 'wrk_live',
                  slug,
                  name: 'Live Lab',
                  planId: 'team'
                })
              )
            )
          ),
          undefined,
          bindings
        )
        expect(generated).toEqual({
          _tag: 'skipped',
          reason: 'workspace_suspended'
        })
        expect(ports.objects.size).toBe(0)
        yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceSuspensionService, (suspension) =>
            suspension.transition({
              workspaceId: 'wrk_live',
              action: 'unsuspend',
              actor: { userId: 'usr_sysadmin' },
              internalReason: 'generation test cleanup'
            })
          )
        )
        const listed = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.list),
          undefined,
          bindings
        )
        expect(listed.find((row) => row.id === requested.id)).toMatchObject({
          status: 'failed',
          failureReason: 'workspace_suspended'
        })
      })
    )

    it.effect('settles suspension during completion without replacing the row', () =>
      Effect.gen(function* () {
        const ports = stubPorts()
        const bindings = { workspaceExports: ports.workspaceExports }
        const requested = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.request),
          { userId: 'usr_owner' },
          bindings
        )
        const exports = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (service) => Effect.succeed(service)),
          undefined,
          bindings
        )
        const duringCompletion: WorkspaceExportsInterface = {
          ...exports,
          complete: () =>
            Effect.fail(new WorkspaceSuspended({ workspaceId: 'wrk_live' }))
        }
        const generated = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExportGeneration, (generation) =>
            generation.generate({
              message: {
                exportId: requested.id,
                workspaceId: 'wrk_live',
                workspaceSlug: 'live-lab'
              },
              finalAttempt: false
            })
          ).pipe(
            Effect.provide(
              WorkspaceExportGenerationLayer((slug) =>
                testWorkspaceContext({
                  id: 'wrk_live',
                  slug,
                  name: 'Live Lab',
                  planId: 'team'
                })
              ).pipe(Layer.provide(Layer.succeed(WorkspaceExports)(duringCompletion)))
            )
          ),
          undefined,
          bindings
        )
        expect(generated).toEqual({
          _tag: 'skipped',
          reason: 'workspace_suspended'
        })
        expect(ports.objects.size).toBe(0)
        const listed = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (service) => service.list),
          undefined,
          bindings
        )
        expect(listed.find((row) => row.id === requested.id)).toMatchObject({
          status: 'failed',
          failureReason: 'workspace_suspended'
        })
      })
    )

    it.effect(
      'retries a transient snapshot failure and settles it on the final attempt',
      () =>
        Effect.gen(function* () {
          const ports = stubPorts()
          const bindings = { workspaceExports: ports.workspaceExports }
          const requested = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(WorkspaceExports, (exports) => exports.request),
            { userId: 'usr_owner' },
            bindings
          )
          const membership = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(WorkspaceMembership, (service) => Effect.succeed(service)),
            undefined,
            bindings
          )
          const failingMembership = WorkspaceMembership.of({
            ...membership,
            listMembers: Effect.fail(
              new CapabilityUnavailable({
                capability: 'workspace-membership',
                reason: 'snapshot unavailable'
              })
            )
          })
          const generated = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(WorkspaceExportGeneration, (generation) =>
              generation.generate({
                message: {
                  exportId: requested.id,
                  workspaceId: 'wrk_live',
                  workspaceSlug: 'live-lab'
                },
                finalAttempt: false
              })
            ).pipe(
              Effect.provide(
                WorkspaceExportGenerationLayer((slug) =>
                  testWorkspaceContext({
                    id: 'wrk_live',
                    slug,
                    name: 'Live Lab',
                    planId: 'team'
                  })
                ).pipe(
                  Layer.provide(Layer.succeed(WorkspaceMembership)(failingMembership))
                )
              )
            ),
            undefined,
            bindings
          )
          expect(generated).toMatchObject({
            _tag: 'retry',
            reason: 'snapshot unavailable'
          })
          const finalGenerated = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(WorkspaceExportGeneration, (generation) =>
              generation.generate({
                message: {
                  exportId: requested.id,
                  workspaceId: 'wrk_live',
                  workspaceSlug: 'live-lab'
                },
                finalAttempt: true
              })
            ).pipe(
              Effect.provide(
                WorkspaceExportGenerationLayer((slug) =>
                  testWorkspaceContext({
                    id: 'wrk_live',
                    slug,
                    name: 'Live Lab',
                    planId: 'team'
                  })
                ).pipe(
                  Layer.provide(Layer.succeed(WorkspaceMembership)(failingMembership))
                )
              )
            ),
            undefined,
            bindings
          )
          expect(finalGenerated).toMatchObject({
            _tag: 'skipped',
            reason: 'unavailable: snapshot unavailable'
          })
          const listed = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(WorkspaceExports, (exports) => exports.list),
            undefined,
            bindings
          )
          expect(listed.find((row) => row.id === requested.id)).toMatchObject({
            status: 'failed',
            failureReason: 'unavailable: snapshot unavailable'
          })
        })
    )

    it.effect('returns retry for a transient completion failure', () =>
      Effect.gen(function* () {
        const ports = stubPorts({ failPut: true })
        const bindings = { workspaceExports: ports.workspaceExports }
        const requested = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.request),
          { userId: 'usr_owner' },
          bindings
        )
        const generated = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExportGeneration, (generation) =>
            generation.generate({
              message: {
                exportId: requested.id,
                workspaceId: 'wrk_live',
                workspaceSlug: 'live-lab'
              },
              finalAttempt: false
            })
          ).pipe(
            Effect.provide(
              WorkspaceExportGenerationLayer((slug) =>
                testWorkspaceContext({
                  id: 'wrk_live',
                  slug,
                  name: 'Live Lab',
                  planId: 'team'
                })
              )
            )
          ),
          undefined,
          bindings
        )
        expect(generated).toMatchObject({ _tag: 'retry' })
        const listed = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.list),
          undefined,
          bindings
        )
        expect(listed.find((row) => row.id === requested.id)?.status).toBe('pending')
      })
    )

    it.effect('keeps a pending row and exposes a terminal settlement outage', () =>
      Effect.gen(function* () {
        const ports = stubPorts()
        const bindings = { workspaceExports: ports.workspaceExports }
        const requested = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.request),
          { userId: 'usr_owner' },
          bindings
        )
        const exports = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (service) => Effect.succeed(service)),
          undefined,
          bindings
        )
        const membership = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceMembership, (service) => Effect.succeed(service)),
          undefined,
          bindings
        )
        const failingMembership = WorkspaceMembership.of({
          ...membership,
          listMembers: Effect.fail(
            new CapabilityUnavailable({
              capability: 'workspace-membership',
              reason: 'snapshot unavailable'
            })
          )
        })
        const failingSettlement: WorkspaceExportsInterface = {
          ...exports,
          fail: () =>
            Effect.fail(
              new CapabilityUnavailable({
                capability: 'workspace-exports',
                reason: 'settlement unavailable'
              })
            )
        }
        const exited = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExportGeneration, (generation) =>
            Effect.exit(
              generation.generate({
                message: {
                  exportId: requested.id,
                  workspaceId: 'wrk_live',
                  workspaceSlug: 'live-lab'
                },
                finalAttempt: true
              })
            )
          ).pipe(
            Effect.provide(
              WorkspaceExportGenerationLayer((slug) =>
                testWorkspaceContext({
                  id: 'wrk_live',
                  slug,
                  name: 'Live Lab',
                  planId: 'team'
                })
              ).pipe(
                Layer.provide(Layer.succeed(WorkspaceExports)(failingSettlement)),
                Layer.provide(Layer.succeed(WorkspaceMembership)(failingMembership))
              )
            )
          ),
          undefined,
          bindings
        )
        expect(exited._tag).toBe('Failure')
        const listed = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (service) => service.list),
          undefined,
          bindings
        )
        expect(listed.find((row) => row.id === requested.id)?.status).toBe('pending')
      })
    )

    it.effect('marks a pending export failed once, and only in its own workspace', () =>
      Effect.gen(function* () {
        const fixedNow = DateTime.makeUnsafe('2026-09-02T10:00:00.000Z')
        yield* TestClock.setTime(DateTime.toEpochMillis(fixedNow))
        const ports = stubPorts()
        const bindings = { workspaceExports: ports.workspaceExports }
        const requested = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.request),
          { userId: 'usr_owner' },
          bindings
        )
        const wrongWorkspace = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.fail({
              exportId: requested.id,
              workspaceId: 'wrk_other',
              reason: 'nope'
            })
          ),
          undefined,
          bindings
        )
        expect(wrongWorkspace).toBe(false)
        const failed = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.fail({
              exportId: requested.id,
              workspaceId: 'wrk_live',
              reason: 'workspace_not_found'
            })
          ),
          undefined,
          bindings
        )
        expect(failed).toBe(true)
        const listed = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.list),
          undefined,
          bindings
        )
        expect(listed.find((row) => row.id === requested.id)).toMatchObject({
          status: 'failed',
          failureReason: 'workspace_not_found',
          completedAt: DateTime.formatIso(fixedNow)
        })
        const twice = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.fail({
              exportId: requested.id,
              workspaceId: 'wrk_live',
              reason: 'x'
            })
          ),
          undefined,
          bindings
        )
        expect(twice).toBe(false)
      })
    )

    it.effect(
      'settles a final completion failure instead of leaving the row pending',
      () =>
        Effect.gen(function* () {
          const ports = stubPorts({ failPut: true })
          const bindings = { workspaceExports: ports.workspaceExports }
          const requested = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(WorkspaceExports, (exports) => exports.request),
            { userId: 'usr_owner' },
            bindings
          )
          const generated = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(WorkspaceExportGeneration, (generation) =>
              generation.generate({
                message: {
                  exportId: requested.id,
                  workspaceId: 'wrk_live',
                  workspaceSlug: 'live-lab'
                },
                finalAttempt: true
              })
            ).pipe(
              Effect.provide(
                WorkspaceExportGenerationLayer((slug) =>
                  testWorkspaceContext({
                    id: 'wrk_live',
                    slug,
                    name: 'Live Lab',
                    planId: 'team'
                  })
                )
              )
            ),
            undefined,
            bindings
          )
          expect(generated).toMatchObject({ _tag: 'skipped' })
          if (generated._tag === 'skipped') {
            expect(generated.reason).toMatch(/^unavailable: /)
          }
          const listed = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(WorkspaceExports, (exports) => exports.list),
            undefined,
            bindings
          )
          expect(listed.find((row) => row.id === requested.id)).toMatchObject({
            status: 'failed',
            failureReason: 'unavailable: bucket unavailable'
          })
        })
    )

    it.effect('refuses export requests while the workspace is suspended', () =>
      Effect.gen(function* () {
        const ports = stubPorts()
        const bindings = { workspaceExports: ports.workspaceExports }
        yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceSuspensionService, (suspension) =>
            suspension.transition({
              workspaceId: 'wrk_live',
              action: 'suspend',
              actor: { userId: 'usr_sysadmin' },
              internalReason: 'export policy review',
              customerExplanation: 'Access is temporarily limited.'
            })
          )
        )
        const refused = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => Effect.exit(exports.request)),
          { userId: 'usr_owner' },
          bindings
        )
        expect(refused._tag).toBe('Failure')
        yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceSuspensionService, (suspension) =>
            suspension.transition({
              workspaceId: 'wrk_live',
              action: 'unsuspend',
              actor: { userId: 'usr_sysadmin' },
              internalReason: 'test cleanup'
            })
          )
        )
      })
    )

    it.effect('refuses signed-link issuance and download after suspension', () =>
      Effect.gen(function* () {
        const ports = stubPorts()
        const bindings = { workspaceExports: ports.workspaceExports }
        const requested = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) => exports.request),
          { userId: 'usr_owner' },
          bindings
        )
        yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.complete({
              exportId: requested.id,
              workspaceId: 'wrk_live',
              archive
            })
          ),
          undefined,
          bindings
        )
        const link = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.issueDownloadLink({
              recipient: { type: 'api_token' },
              exportId: requested.id
            })
          ),
          { userId: 'usr_owner' },
          bindings
        )
        expect(Option.isSome(link)).toBe(true)
        if (Option.isNone(link)) {
          return
        }
        const params = linkParams(link.value.path)
        yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceSuspensionService, (suspension) =>
            suspension.transition({
              workspaceId: 'wrk_live',
              action: 'suspend',
              actor: { userId: 'usr_sysadmin' },
              internalReason: 'download policy review',
              customerExplanation: 'Access is temporarily limited.'
            })
          )
        )
        const refusedLink = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            Effect.exit(
              exports.issueDownloadLink({
                recipient: { type: 'api_token' },
                exportId: requested.id
              })
            )
          ),
          { userId: 'usr_owner' },
          bindings
        )
        expect(refusedLink._tag).toBe('Failure')
        const refusedDownload = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            Effect.exit(
              exports.openDownload({
                exportId: requested.id,
                expires: params.expires,
                signature: params.signature
              })
            )
          ),
          undefined,
          bindings
        )
        expect(refusedDownload._tag).toBe('Failure')
      })
    )
  })
})
