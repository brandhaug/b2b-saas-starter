import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import {
  CapabilityUnavailable,
  WorkspaceNotFound
} from '@b2b-saas-starter/capabilities/errors'
import { AuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  WORKSPACE_EXPORT_RETENTION_DAYS as CAPABILITY_RETENTION_DAYS,
  WorkspaceExports,
  type CompleteWorkspaceExportInput,
  type FailWorkspaceExportInput,
  WorkspaceExportQueueMessage,
  type WorkspaceExportsInterface
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { WorkspaceInvitations } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import {
  testWorkspaceContext,
  WorkspaceContext
} from '@b2b-saas-starter/capabilities/workspace-context'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import {
  WORKSPACE_EXPORT_RETENTION_DAYS,
  workspaceExportConsumerSettings
} from '../../../infra/bindings.ts'
import {
  processWorkspaceExportMessage,
  type ResolveWorkspace
} from './export-consumer.ts'
import { readDelivery } from './queue-consumer.ts'

const workspace = { id: 'wrk_1', slug: 'lab', name: 'Lab', planId: 'team' }

const message: WorkspaceExportQueueMessage = {
  exportId: 'exp_1',
  workspaceId: 'wrk_1',
  workspaceSlug: 'lab'
}

/** What the stub export service saw: the completions and failures it was handed. */
type Recorded = {
  readonly completed: Array<CompleteWorkspaceExportInput>
  readonly failed: Array<FailWorkspaceExportInput>
}

function stubExports(recorded: Recorded): Layer.Layer<WorkspaceExports> {
  const unused = Effect.die('unused in consumer tests')
  const service: WorkspaceExportsInterface = {
    availability: Effect.succeed({ available: true }),
    list: unused,
    request: unused,
    issueDownloadLink: () => unused,
    openDownload: () => unused,
    complete: (input) =>
      Effect.sync(() => {
        recorded.completed.push(input)
        return true
      }),
    fail: (input) =>
      Effect.sync(() => {
        recorded.failed.push(input)
        return true
      })
  }
  return Layer.succeed(WorkspaceExports)(service)
}

/**
 * Empty read services — the archive shape is the capability tests' business;
 * the consumer tests assert the orchestration. `failing` turns every read into
 * a store outage.
 */
function stubReads(failing = false) {
  const outage = new CapabilityUnavailable({ capability: 'test', reason: 'd1 down' })
  function list<A>(value: A): Effect.Effect<A, CapabilityUnavailable> {
    if (failing) {
      return Effect.fail(outage)
    }
    return Effect.succeed(value)
  }
  const unused = Effect.die('unused in consumer tests')
  return Layer.mergeAll(
    Layer.succeed(WorkspaceMembership)({
      listMembers: list([]),
      listMembersPage: () => unused,
      listWorkspacesForUser: () => unused,
      addMember: () => unused,
      removeMember: () => unused,
      leave: unused,
      changeRole: () => unused
    }),
    Layer.succeed(WorkspaceInvitations)({
      list: list([]),
      create: () => unused,
      cancel: () => unused,
      find: () => unused,
      accept: () => unused
    }),
    Layer.succeed(ApiTokenRegistry)({
      list: list([]),
      listPage: () => unused,
      create: () => unused,
      replace: () => unused,
      revoke: () => unused,
      verifyBearerToken: () => unused
    }),
    Layer.succeed(WebhookEndpoints)({
      list: list([]),
      listPage: () => unused,
      create: () => unused,
      listDeliveryAttempts: () => Effect.die('unused in delivery tests'),
      cleanupDeliveryHistory: () => Effect.die('unused in delivery tests'),
      listDeliveries: () => unused,
      listGlobalDeliveries: () => unused,
      replayDeliveryAsAdmin: () => unused,
      update: () => unused,
      delete: () => unused,
      replayDelivery: () => unused,
      sendTestEvent: () => unused,
      rotateSecret: () => unused,
      getDispatchTarget: () => unused,
      recordDeliveryAttempt: () => unused,
      recordTerminalDeliveryAttempt: () => unused
    }),
    Layer.succeed(AuditEventLog)({
      get: () => unused,
      list: () => list({ items: [], nextCursor: null }),
      listGlobal: unused,
      record: () => unused,
      prepareRecord: () => unused
    }),
    Layer.succeed(NotificationFeed)({
      list: list([]),
      listPage: () => unused,
      unreadCount: list(0),
      markRead: () => unused,
      notifyUser: () => unused,
      notifyWorkspaceOwners: () => unused,
      create: () => unused,
      loadForEmail: () => unused,
      listDigestCandidates: () => unused,
      record: () => unused
    })
  )
}

function resolveLab(slug: string): ReturnType<ResolveWorkspace> {
  if (slug === 'lab') {
    return testWorkspaceContext(workspace)
  }
  return Layer.effect(WorkspaceContext)(Effect.fail(new WorkspaceNotFound({ slug })))
}

function run(
  body: unknown,
  options: {
    readonly attempts?: number
    readonly resolve?: ResolveWorkspace
    readonly failing?: boolean
  } = {}
) {
  const recorded: Recorded = { completed: [], failed: [] }
  return processWorkspaceExportMessage(
    readDelivery(WorkspaceExportQueueMessage, {
      id: 'qmsg_export',
      body,
      attempts: options.attempts ?? 1
    }),
    options.resolve ?? resolveLab
  ).pipe(
    Effect.provide(
      Layer.mergeAll(stubExports(recorded), stubReads(options.failing ?? false))
    ),
    Effect.map((outcome) => ({ outcome, recorded }))
  )
}

describe('processWorkspaceExportMessage', () => {
  it.effect('builds the archive and completes the export', () =>
    Effect.gen(function* () {
      const { outcome, recorded } = yield* run(message)
      expect(outcome).toBe('ack')
      expect(recorded.failed).toHaveLength(0)
      expect(recorded.completed).toHaveLength(1)
      const completed = recorded.completed[0]
      expect(completed).toMatchObject({ exportId: 'exp_1', workspaceId: 'wrk_1' })
      // A real gzip container: magic bytes first.
      expect([...(completed?.archive.subarray(0, 2) ?? [])]).toEqual([0x1f, 0x8b])
      expect(completed?.archive.length).toBeGreaterThan(22)
    })
  )

  it.effect('acks a malformed message without touching any row', () =>
    Effect.gen(function* () {
      const { outcome, recorded } = yield* run({ exportId: 42 })
      expect(outcome).toBe('ack')
      expect(recorded.completed).toHaveLength(0)
      expect(recorded.failed).toHaveLength(0)
    })
  )

  it.effect('marks the export failed when the slug no longer resolves', () =>
    Effect.gen(function* () {
      const { outcome, recorded } = yield* run({ ...message, workspaceSlug: 'gone' })
      expect(outcome).toBe('ack')
      expect(recorded.completed).toHaveLength(0)
      expect(recorded.failed[0]).toMatchObject({
        exportId: 'exp_1',
        workspaceId: 'wrk_1',
        reason: 'workspace_not_found'
      })
    })
  )

  it.effect(
    'marks the export failed when the slug resolves to a different workspace',
    () =>
      Effect.gen(function* () {
        const { outcome, recorded } = yield* run({ ...message, workspaceId: 'wrk_old' })
        expect(outcome).toBe('ack')
        expect(recorded.completed).toHaveLength(0)
        expect(recorded.failed[0]).toMatchObject({
          workspaceId: 'wrk_old',
          reason: 'workspace_mismatch'
        })
      })
  )

  it.effect('retries a store outage while attempts remain', () =>
    Effect.gen(function* () {
      const { outcome, recorded } = yield* run(message, {
        failing: true,
        attempts: 1
      })
      expect(outcome).toBe('retry')
      expect(recorded.failed).toHaveLength(0)
      expect(recorded.completed).toHaveLength(0)
    })
  )

  it.effect(
    'marks the export failed on the last attempt instead of retrying forever',
    () =>
      Effect.gen(function* () {
        const { outcome, recorded } = yield* run(message, {
          failing: true,
          attempts: workspaceExportConsumerSettings.maxRetries
        })
        expect(outcome).toBe('ack')
        expect(recorded.failed[0]?.reason).toMatch(/^unavailable: /)
      })
  )
})

describe('readDelivery', () => {
  it('decodes the producer schema, traceparent included', () => {
    const delivery = readDelivery(WorkspaceExportQueueMessage, {
      id: 'qmsg_1',
      body: { ...message, traceparent: '00-abc-def-01' },
      attempts: 2
    })
    expect(delivery).toEqual({
      id: 'qmsg_1',
      attempts: 2,
      kind: 'message',
      message: { ...message, traceparent: '00-abc-def-01' }
    })
  })

  it('names a body that misses the workspace slug malformed', () => {
    expect(
      readDelivery(WorkspaceExportQueueMessage, {
        id: 'qmsg_2',
        body: { exportId: 'x', workspaceId: 'y' },
        attempts: 1
      })
    ).toEqual({ id: 'qmsg_2', attempts: 1, kind: 'malformed' })
  })
})

describe('retention horizon', () => {
  it('keeps the bucket lifecycle rule and the row expiry on one number', () => {
    // `infra/bindings.ts` drives the R2 lifecycle rule; the capability stamps
    // `expiresAt`. Neither imports the other, so this is where they meet.
    expect(CAPABILITY_RETENTION_DAYS).toBe(WORKSPACE_EXPORT_RETENTION_DAYS)
  })
})
