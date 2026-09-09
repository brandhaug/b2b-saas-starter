import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { describe, expect } from 'vite-plus/test'

import {
  AuditEventLog,
  recordCompletedAudit,
  type RecordAuditEventInput
} from './audit-event-log.ts'

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
