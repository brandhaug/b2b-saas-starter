import { auditEvents } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { DateTime, Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { AUDIT_EVENT_PAGE_SIZE, AuditEventLog } from './audit-event-log.ts'
import { auditEventLogContractCases } from './audit-event-log.contract.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('live audit event log', (it) => {
  describe('live audit event read contract', () => {
    const cases = auditEventLogContractCases(
      (input) => Effect.flatMap(AuditEventLog, (log) => log.list(input)),
      expect
    )
    for (const contractCase of cases) {
      it.effect(contractCase.name, () => inWorkspace('audit-lab', contractCase.assert))
    }
  })

  describe('live audit event keyset pagination', () => {
    // More rows than the fixed page cap, so the first page must cut off and
    // offer a cursor — the one shared-contract case the dataset is too small
    // to exercise.
    function insertPage(start: number, rowCount: number) {
      return Effect.gen(function* () {
        const db = yield* Database
        const rows = Array.from({ length: rowCount }, (_, index) => ({
          id: `aud_pg_${String(start + index).padStart(4, '0')}`,
          workspaceId: 'wrk_audit_pages',
          eventType: 'page.filler',
          targetType: 'test',
          targetId: null,
          metadata: {},
          // Fixed literal base, not a clock read.
          createdAt: DateTime.formatIso(
            DateTime.makeUnsafe(Date.UTC(2026, 5, 10, 0, index * 2))
          )
        }))
        // D1 binds at most 100 parameters per statement (8 per row here).
        for (let i = 0; i < rows.length; i += 10) {
          yield* db.insert(auditEvents).values(rows.slice(i, i + 10))
        }
      })
    }

    it.effect('caps a full page and resumes from its cursor', () =>
      Effect.flatMap(insertPage(0, AUDIT_EVENT_PAGE_SIZE + 7), () =>
        inWorkspace(
          'audit-pages-lab',
          Effect.gen(function* () {
            const audit = yield* AuditEventLog
            const first = yield* audit.list()
            expect(first.events).toHaveLength(AUDIT_EVENT_PAGE_SIZE)
            if (first.nextCursor === null) {
              throw new Error('expected a cursor on a full page')
            }
            const second = yield* audit.list({ cursor: first.nextCursor })
            expect(second.events).toHaveLength(7)
            expect(second.nextCursor).toBe(null)
            // No overlap across the page boundary.
            const firstIds = new Set(first.events.map((event) => event.id))
            expect(second.events.some((event) => firstIds.has(event.id))).toBe(false)
            // And an empty filter result offers no cursor.
            const none = yield* audit.list({ eventType: 'no.such.event' })
            expect(none.events).toHaveLength(0)
            expect(none.nextCursor).toBe(null)
          })
        )
      )
    )
  })

  describe('live audit event workspace isolation', () => {
    it.effect("lists only the requesting workspace's events", () =>
      Effect.gen(function* () {
        yield* inWorkspace(
          'other-lab',
          Effect.gen(function* () {
            const audit = yield* AuditEventLog
            yield* audit.record({
              workspaceId: 'wrk_other',
              eventType: 'workspace.created',
              targetType: 'workspace'
            })
          })
        )
        const liveEvents = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const audit = yield* AuditEventLog
            return (yield* audit.list()).events
          })
        )
        expect(
          liveEvents.some((event) => event.eventType === 'workspace.created')
        ).toBe(false)
        const otherEvents = yield* inWorkspace(
          'other-lab',
          Effect.gen(function* () {
            const audit = yield* AuditEventLog
            return (yield* audit.list()).events
          })
        )
        expect(
          otherEvents.some((event) => event.eventType === 'workspace.created')
        ).toBe(true)
      })
    )
  })
})
