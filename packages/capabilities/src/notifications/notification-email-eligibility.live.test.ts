import { notifications, workspaceMembers } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { and, eq } from 'drizzle-orm'
import { DateTime, Effect } from 'effect'
import { expect, layer } from '@effect/vitest'

import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { NotificationEmailEligibility } from './notification-email-eligibility.ts'
import { NotificationFeed } from './notification-feed.ts'

let caseCounter = 0

function freshId(label: string): string {
  caseCounter += 1
  return `not_eligibility_${label}_${DateTime.nowUnsafe().epochMillis}_${caseCounter}`
}

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live notification email eligibility',
  (it) => {
    it.effect(
      're-reads the Live feed after an instant notification becomes read',
      () => {
        const notificationId = freshId('instant_read')
        return inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const db = yield* Database
            yield* db.insert(notifications).values({
              id: notificationId,
              workspaceId: 'wrk_live',
              userId: 'usr_owner',
              kind: 'api_token.created',
              title: 'Live read check',
              message: 'Unread initially.',
              readAt: null,
              createdAt: '2026-09-02T10:00:00.000Z'
            })

            const eligibility = yield* NotificationEmailEligibility
            const feed = yield* NotificationFeed
            const input = { notificationId, recipientUserId: 'usr_owner' }

            expect(yield* eligibility.instant(input)).toMatchObject({ _tag: 'deliver' })
            expect(yield* feed.markRead([notificationId])).toBe(1)
            expect(yield* eligibility.instant(input)).toEqual({
              _tag: 'skip',
              reason: 'not_deliverable'
            })
          }),
          { userId: 'usr_owner' }
        )
      }
    )

    it.effect('re-reads Live membership before instant delivery', () => {
      const notificationId = freshId('instant_membership')
      const membershipId = freshId('membership')
      return inWorkspace(
        'live-lab',
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(workspaceMembers).values({
            id: membershipId,
            workspaceId: 'wrk_live',
            userId: 'usr_joiner',
            role: 'member'
          })
          yield* db.insert(notifications).values({
            id: notificationId,
            workspaceId: 'wrk_live',
            kind: 'api_token.created',
            title: 'Live membership check',
            message: 'Visible while the member belongs to the workspace.',
            readAt: null,
            createdAt: '2026-09-02T10:00:00.000Z'
          })

          const eligibility = yield* NotificationEmailEligibility
          const input = { notificationId, recipientUserId: 'usr_joiner' }
          expect(yield* eligibility.instant(input)).toMatchObject({ _tag: 'deliver' })

          yield* db
            .delete(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.id, membershipId),
                eq(workspaceMembers.userId, 'usr_joiner')
              )
            )
          expect(yield* eligibility.instant(input)).toEqual({
            _tag: 'skip',
            reason: 'not_deliverable'
          })
        })
      )
    })

    it.effect('re-reads Live membership before digest selection', () => {
      const notificationId = freshId('digest_membership')
      const membershipId = freshId('membership')
      return inWorkspace(
        'live-lab',
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(workspaceMembers).values({
            id: membershipId,
            workspaceId: 'wrk_live',
            userId: 'usr_joiner',
            role: 'member'
          })
          yield* db.insert(notifications).values({
            id: notificationId,
            workspaceId: 'wrk_live',
            kind: 'announcement',
            title: 'Live digest membership check',
            message: 'Visible while the member belongs to the workspace.',
            readAt: null,
            createdAt: '2026-09-02T10:00:00.000Z'
          })

          const eligibility = yield* NotificationEmailEligibility
          const window = {
            since: '2026-09-02T00:00:00.000Z',
            until: '2026-09-03T00:00:00.000Z'
          }
          const before = yield* eligibility.digest(window)
          expect(
            before.candidates.map((candidate) => candidate.recipient.userId)
          ).toContain('usr_joiner')

          yield* db
            .delete(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.id, membershipId),
                eq(workspaceMembers.userId, 'usr_joiner')
              )
            )
          const after = yield* eligibility.digest(window)
          expect(
            after.candidates.map((candidate) => candidate.recipient.userId)
          ).not.toContain('usr_joiner')
        })
      )
    })
  }
)
