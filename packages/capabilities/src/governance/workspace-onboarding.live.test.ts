import { auditEvents, user } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'
import { and, eq } from 'drizzle-orm'

import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { WorkspaceOnboarding } from './workspace-onboarding.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live workspace onboarding',
  (it) => {
    describe('live workspace onboarding', () => {
      it.effect('reads two-factor from the actor account and false without one', () =>
        Effect.gen(function* () {
          const db = yield* Database
          yield* db
            .update(user)
            .set({ twoFactorEnabled: true })
            .where(eq(user.id, 'usr_owner'))
          const read = Effect.flatMap(
            WorkspaceOnboarding,
            (onboarding) => onboarding.actorTwoFactorEnabled
          )
          expect(yield* inWorkspace('live-lab', read, { userId: 'usr_owner' })).toBe(
            true
          )
          expect(yield* inWorkspace('live-lab', read)).toBe(false)
        })
      )

      it.effect('dismisses once, audits it, and reads the dismissal back', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const program = Effect.gen(function* () {
            const onboarding = yield* WorkspaceOnboarding
            const before = yield* onboarding.dismissedAt
            const first = yield* onboarding.dismiss
            const second = yield* onboarding.dismiss
            const after = yield* onboarding.dismissedAt
            return { before, first, second, after }
          })
          const result = yield* inWorkspace('live-lab', program, {
            userId: 'usr_owner'
          })
          expect(result.before).toBeNull()
          expect(result.first).toBe(true)
          expect(result.second).toBe(false)
          expect(result.after).toMatch(/^\d{4}-\d{2}-\d{2}T/)

          const rows = yield* db
            .select()
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.workspaceId, 'wrk_live'),
                eq(auditEvents.eventType, 'workspace.onboarding_dismissed')
              )
            )
          // The second dismiss matched nothing, so one audit row, not two.
          expect(rows).toHaveLength(1)
          expect(rows[0]?.actorUserId).toBe('usr_owner')
        })
      )
    })
  }
)
