import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { describe, expect } from 'vite-plus/test'

import {
  AuditEventLog,
  recordCompletedAudit,
  type RecordAuditEventInput,
  SeedAuditEventLog,
  type SeedAuditEventRow,
  type AuditView
} from './audit-event-log.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import { seedWorkspaceRecord } from '../seed-fixture.ts'

const input: RecordAuditEventInput = {
  workspaceId: 'wrk_test',
  actorUserId: 'usr_test',
  actorType: 'user',
  eventType: 'workspace.renamed',
  targetType: 'workspace',
  targetId: 'wrk_test',
  metadata: {}
}

describe('completed mutation audit', () => {
  it.effect('returns success when a post-action audit write is unavailable', () =>
    Effect.gen(function* () {
      let recordCalls = 0
      const audit = AuditEventLog.of({
        get: () => Effect.succeed(null),
        list: () => Effect.succeed({ items: [], nextCursor: null }),
        listGlobal: Effect.succeed([]),
        record: () =>
          Effect.sync(() => {
            recordCalls += 1
            return Effect.fail(
              new CapabilityUnavailable({
                capability: 'audit-event-log',
                reason: 'test_unavailable'
              })
            )
          }).pipe(Effect.flatten),
        prepareRecord: () =>
          Effect.succeed({ toSQL: () => ({ sql: 'select 1', params: [] }) })
      })

      yield* recordCompletedAudit(audit, input, 'workspace_lifecycle.rename')
      expect(recordCalls).toBe(1)
    })
  )
})

describe('advanced audit views', () => {
  it.effect('filters and sorts the complete Seed dataset across cursor pages', () => {
    const rows: ReadonlyArray<SeedAuditEventRow> = [
      {
        id: 'aud_a',
        workspaceId: seedWorkspaceRecord.id,
        actorUserId: 'usr_a',
        actorType: 'user',
        actor: 'A',
        eventType: 'workspace.renamed',
        targetType: 'workspace',
        targetId: null,
        createdAt: '2026-01-03T00:00:00.000Z'
      },
      {
        id: 'aud_b',
        workspaceId: seedWorkspaceRecord.id,
        actorUserId: 'usr_b',
        actorType: 'user',
        actor: 'B',
        eventType: 'workspace.deleted',
        targetType: 'workspace',
        targetId: null,
        createdAt: '2026-01-02T00:00:00.000Z'
      },
      {
        id: 'aud_c',
        workspaceId: seedWorkspaceRecord.id,
        actorUserId: 'usr_a',
        actorType: 'user',
        actor: 'A',
        eventType: 'workspace.renamed',
        targetType: 'workspace',
        targetId: null,
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const layer = Layer.merge(
      SeedAuditEventLog(rows),
      testWorkspaceContext(seedWorkspaceRecord, {
        userId: 'usr_a',
        role: 'owner',
        systemRole: 'admin'
      })
    )
    return Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const view: AuditView = {
        match: 'all',
        filters: [
          {
            field: 'eventType',
            operator: 'contains',
            value: 'workspace'
          }
        ],
        sorts: [
          { field: 'actorUserId', direction: 'asc' },
          { field: 'createdAt', direction: 'desc' }
        ]
      }
      const first = yield* audit.list({ view, limit: 1 })
      expect(first.items.map((row) => row.id)).toEqual(['aud_a'])
      expect(first.nextCursor).not.toBeNull()
      const second = yield* audit.list({
        view,
        limit: 2,
        cursor: first.nextCursor ?? undefined
      })
      expect(second.items.map((row) => row.id)).toEqual(['aud_c', 'aud_b'])
      const any = yield* audit.list({
        view: {
          ...view,
          match: 'any',
          filters: [
            { field: 'eventType', operator: 'is', value: 'workspace.deleted' },
            { field: 'actorUserId', operator: 'is', value: 'usr_a' }
          ]
        },
        limit: 10
      })
      expect(any.items.map((row) => row.id)).toEqual(['aud_a', 'aud_c', 'aud_b'])
      const reused = yield* audit.list({
        view: { ...view, sorts: [{ field: 'createdAt', direction: 'asc' }] },
        cursor: first.nextCursor ?? undefined
      })
      expect(reused.items).toEqual([])
    }).pipe(Effect.provide(layer))
  })
})
