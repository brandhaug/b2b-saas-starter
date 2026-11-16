import { UserId, WorkspaceId } from '@b2b-saas-starter/db/ids'
import { notifications } from '@b2b-saas-starter/db/schema/notifications'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import { makeLiveCapabilitiesLayer } from './layers.ts'
import { WorkspaceMembership } from './governance/workspace-membership.ts'
import { NotificationFeed } from './notifications/notification-feed.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from './testing/live-harness.ts'
import { listWorkspacesForUser } from './workspace-projections.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live workspace list projection',
  (it) => {
    describe('counts', () => {
      it.effect(
        'match the per-workspace member and visible notification reads in every workspace',
        () =>
          Effect.gen(function* () {
            const db = yield* Database
            // Rows the owner can and cannot see, across two of their workspaces.
            yield* db.insert(notifications).values([
              {
                id: 'not_projection_broadcast',
                workspaceId: WorkspaceId.make('wrk_live'),
                title: 'Broadcast',
                message: 'Every member sees this.',
                createdAt: '2026-06-10T08:00:00.000Z'
              },
              {
                id: 'not_projection_owner',
                workspaceId: WorkspaceId.make('wrk_live'),
                userId: UserId.make('usr_owner'),
                title: 'For the owner',
                message: 'Only the owner sees this.',
                createdAt: '2026-06-10T07:00:00.000Z'
              },
              {
                id: 'not_projection_alice',
                workspaceId: WorkspaceId.make('wrk_live'),
                userId: UserId.make('usr_alice'),
                title: 'For Alice',
                message: 'The owner never sees this.',
                createdAt: '2026-06-10T06:00:00.000Z'
              },
              {
                id: 'not_projection_other',
                workspaceId: WorkspaceId.make('wrk_other'),
                title: 'Other broadcast',
                message: 'Every member of the other lab sees this.',
                createdAt: '2026-06-10T05:00:00.000Z'
              }
            ])

            const items = yield* Effect.provide(
              listWorkspacesForUser(UserId.make('usr_owner')),
              makeLiveCapabilitiesLayer({})
            )
            expect(items.length).toBeGreaterThan(1)
            for (const item of items) {
              const expected = yield* inWorkspace(
                item.workspace.slug,
                Effect.gen(function* () {
                  const membership = yield* WorkspaceMembership
                  const feed = yield* NotificationFeed
                  return {
                    memberCount: (yield* membership.listMembers).length,
                    notificationCount: (yield* feed.list).length
                  }
                }),
                { userId: UserId.make('usr_owner') }
              )
              expect({ slug: item.workspace.slug, ...expected }).toEqual({
                slug: item.workspace.slug,
                memberCount: item.memberCount,
                notificationCount: item.notificationCount
              })
            }
            const live = items.find((item) => item.workspace.id === 'wrk_live')
            expect(live?.notificationCount).toBeGreaterThanOrEqual(2)
          })
      )
    })
  }
)
