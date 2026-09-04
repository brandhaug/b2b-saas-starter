import { Effect, Option } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import { NotificationFeed } from '../notifications/notification-feed.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { AuditEventLog } from './audit-event-log.ts'
import {
  WorkspaceExports,
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding,
  type WorkspaceExportQueueMessage
} from './workspace-export.ts'

/**
 * Stub queue and bucket: the Live adapter's platform ports, in memory. The
 * queue records what was enqueued; the bucket is a `Map` the download path
 * reads back from. Together they let the whole request → complete → download
 * lifecycle run against a real D1 without Cloudflare.
 */
function stubPorts() {
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

const archive = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3])

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

  describe('lifecycle', () => {
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
          { exportId: requested.id, workspaceId: 'wrk_live', workspaceSlug: 'live-lab' }
        ])

        // Nothing to hand out while the job is pending.
        const early = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceExports, (exports) =>
            exports.issueDownloadLink({ exportId: requested.id })
          ),
          undefined,
          bindings
        )
        expect(Option.isNone(early)).toBe(true)

        // The background half: no WorkspaceContext, ids from the message.
        const completed = yield* inWorkspace(
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
        expect(completed).toBe(true)
        expect([...ports.objects.keys()]).toEqual([
          `workspaces/wrk_live/${requested.id}.zip`
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
        expect(ready).toMatchObject({ status: 'ready', sizeBytes: archive.length })
        expect(ready?.expiresAt).not.toBeNull()

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
            exports.issueDownloadLink({ exportId: requested.id })
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
        expect(download.value.fileName).toBe(`live-lab-export-${requested.id}.zip`)
        expect([...download.value.body]).toEqual([...archive])

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
            exports.issueDownloadLink({ exportId: requested.id })
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
        const forExport = events.events
          .filter((event) => event.targetId === requested.id)
          .map((event) => event.eventType)
          .toSorted()
        expect(forExport).toEqual([
          'workspace.export_completed',
          'workspace.export_downloaded',
          'workspace.export_requested'
        ])
      })
    )

    it.effect('marks a pending export failed once, and only in its own workspace', () =>
      Effect.gen(function* () {
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
          failureReason: 'workspace_not_found'
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
  })
})
