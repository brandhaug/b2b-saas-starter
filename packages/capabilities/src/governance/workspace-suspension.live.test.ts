import { Effect } from 'effect'
import { Database } from '@b2b-saas-starter/db/service'
import { sql } from 'drizzle-orm'
import { WorkspaceLifecycle } from './workspace-lifecycle.ts'
import { expect, layer } from '@effect/vitest'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { WorkspaceSuspensionService } from './workspace-suspension.ts'
import { workspaceSuspensionContractCases } from './workspace-suspension.contract.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live workspace suspension',
  (it) => {
    for (const testCase of workspaceSuspensionContractCases(expect)) {
      it.effect(testCase.name, () =>
        inWorkspace('live-lab', testCase.assert, undefined)
      )
    }

    it.effect('does not affect another workspace', () =>
      Effect.gen(function* () {
        yield* inWorkspace(
          'live-lab',
          Effect.flatMap(WorkspaceSuspensionService, (suspension) =>
            suspension.transition({
              workspaceId: 'wrk_live',
              action: 'suspend',
              actor: { userId: 'usr_sysadmin' },
              internalReason: 'test',
              customerExplanation: 'Access is temporarily limited.'
            })
          )
        )
        const other = yield* inWorkspace(
          'other-lab',
          Effect.flatMap(WorkspaceSuspensionService, (service) =>
            service.requireAllowed('wrk_other', 'product')
          )
        )
        expect(other).toBeUndefined()
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

    it.effect('rolls back state and audit when notification persistence fails', () =>
      inWorkspace(
        'live-lab',
        Effect.gen(function* () {
          const db = yield* Database
          const suspension = yield* WorkspaceSuspensionService
          const audit = yield* AuditEventLog
          const feed = yield* NotificationFeed
          const beforeAudit = yield* audit.listGlobal
          const beforeNotices = yield* feed.list
          yield* db.run(
            sql`CREATE TRIGGER reject_suspension_notice BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'test notification failure'); END`
          )
          const input = {
            workspaceId: 'wrk_live',
            action: 'suspend',
            actor: { userId: 'usr_sysadmin' },
            internalReason: 'Review',
            customerExplanation: 'Contact support.'
          } satisfies Parameters<typeof suspension.transition>[0]
          const failed = yield* suspension.transition(input).pipe(Effect.result)
          yield* db.run(sql`DROP TRIGGER reject_suspension_notice`)
          expect(failed).toMatchObject({
            _tag: 'Failure',
            failure: { _tag: 'CapabilityUnavailable' }
          })
          expect((yield* suspension.get('wrk_live')).status).toBe('active')
          expect(yield* audit.listGlobal).toEqual(beforeAudit)
          expect(yield* feed.list).toEqual(beforeNotices)
          yield* suspension.transition(input)
          yield* suspension.transition(input)
          expect((yield* feed.list).length - beforeNotices.length).toBe(1)
          const lifecycle = yield* WorkspaceLifecycle
          expect(
            yield* lifecycle.rename({ name: 'Forbidden rename' }).pipe(Effect.result)
          ).toMatchObject({ _tag: 'Failure', failure: { _tag: 'WorkspaceSuspended' } })
          yield* suspension.transition({
            workspaceId: 'wrk_live',
            action: 'unsuspend',
            actor: { userId: 'usr_sysadmin' },
            internalReason: 'Cleanup'
          })
        }),
        { userId: 'usr_owner' }
      )
    )

    it.effect('concurrent same-state transitions produce one audit and notice', () =>
      inWorkspace(
        'live-lab',
        Effect.gen(function* () {
          const suspension = yield* WorkspaceSuspensionService
          const audit = yield* AuditEventLog
          const feed = yield* NotificationFeed
          const beforeAudit = yield* audit.listGlobal
          const beforeNotices = yield* feed.list
          yield* Effect.all(
            [1, 2].map(() =>
              suspension.transition({
                workspaceId: 'wrk_live',
                action: 'suspend',
                actor: { userId: 'usr_sysadmin' },
                internalReason: 'concurrent review',
                customerExplanation: 'Access is temporarily limited.'
              })
            ),
            { concurrency: 'unbounded' }
          )
          const afterAudit = yield* audit.listGlobal
          const afterNotices = yield* feed.list
          expect(
            afterAudit.filter((event) => event.eventType === 'workspace.suspended')
              .length -
              beforeAudit.filter((event) => event.eventType === 'workspace.suspended')
                .length
          ).toBe(1)
          expect(afterNotices.length - beforeNotices.length).toBe(1)
          const transition = afterAudit.find(
            (event) =>
              event.eventType === 'workspace.suspended' && event.targetId === 'wrk_live'
          )
          expect(transition?.actor).toBe('Sys Admin')
          expect(transition?.actorType).toBe('user')
          expect(afterNotices.at(-1)?.message).not.toContain('concurrent review')
        }),
        { userId: 'usr_owner' }
      )
    )
  }
)
