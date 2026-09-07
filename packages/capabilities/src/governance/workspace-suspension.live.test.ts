import { Effect } from 'effect'
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
