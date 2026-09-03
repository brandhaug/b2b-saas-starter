import {
  notifications,
  workspaceMembers,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { eq, inArray } from 'drizzle-orm'
import { DateTime, Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { NotificationFeed } from './notification-feed.ts'
import {
  notificationFeedContractCases,
  type NotificationFeedContractDataset
} from './notification-feed.contract.ts'

// The dataset is installed against the provisioned `wrk_live` workspace and
// deleted again after each case: ids are minted per case so the persistent D1
// never carries state from the previous case (or a previous run — the D1 file
// outlives the process) into the next one, and the teardown keeps the file
// from growing three rows per case forever.
const runPrefix = `not_live_${DateTime.formatIso(DateTime.nowUnsafe())}_`
let caseCounter = 0

function freshIds(): NotificationFeedContractDataset {
  caseCounter += 1
  const suffix = `${runPrefix}${String(caseCounter).padStart(3, '0')}`
  return {
    broadcastUnread: `not_live_broadcast_${suffix}`,
    broadcastRead: `not_live_read_${suffix}`,
    aliceUnread: `not_live_alice_${suffix}`
  }
}

function insertDataset(
  ids: NotificationFeedContractDataset
): Effect.Effect<void, unknown, Database> {
  return Effect.gen(function* () {
    const db = yield* Database
    yield* db.insert(notifications).values([
      {
        id: ids.broadcastUnread,
        workspaceId: 'wrk_live',
        title: 'Live broadcast',
        message: 'An unread workspace broadcast.',
        readAt: null,
        createdAt: '2026-06-10T08:00:00.000Z'
      },
      {
        id: ids.broadcastRead,
        workspaceId: 'wrk_live',
        title: 'Live read broadcast',
        message: 'A broadcast that was read before the case ran.',
        readAt: '2026-06-11T08:00:00.000Z',
        createdAt: '2026-06-10T07:00:00.000Z'
      },
      {
        id: ids.aliceUnread,
        workspaceId: 'wrk_live',
        userId: 'usr_alice',
        title: 'Live row for Alice',
        message: 'Only Alice can see this row.',
        readAt: null,
        createdAt: '2026-06-10T06:00:00.000Z'
      }
    ])
  })
}

/** Drops the case's rows from `wrk_live`, keeping the shared fixture lean. */
function dropDataset(
  ids: NotificationFeedContractDataset
): Effect.Effect<void, unknown, Database> {
  return Effect.gen(function* () {
    const db = yield* Database
    yield* db
      .delete(notifications)
      .where(
        inArray(notifications.id, [
          ids.broadcastUnread,
          ids.broadcastRead,
          ids.aliceUnread
        ])
      )
  })
}

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('live notification feed', (it) => {
  describe('live notification feed contract', () => {
    for (const contractCase of notificationFeedContractCases(freshIds, expect)) {
      it.effect(contractCase.name, () =>
        Effect.flatMap(insertDataset(contractCase.dataset), () =>
          Effect.flatMap(inWorkspace('live-lab', contractCase.assert), () =>
            dropDataset(contractCase.dataset)
          )
        )
      )
    }
  })

  // The actor-scoped cases need a workspace with two members: the addressee
  // (owner) and another member who must not be able to mark the addressee's
  // row. One workspace per case, keyed off the case's own ids so concurrent
  // cases and persistent D1 never collide.
  function provisionActorWorkspace(
    ids: NotificationFeedContractDataset
  ): Effect.Effect<string, unknown, Database> {
    return Effect.gen(function* () {
      const db = yield* Database
      const workspaceId = `wrk_${ids.aliceUnread}`
      const slug = `notification-${ids.aliceUnread}`
      yield* db.insert(workspaces).values({
        id: workspaceId,
        slug,
        name: 'Notification Actor Lab'
      })
      yield* db.insert(workspaceMembers).values([
        {
          id: `mem_${ids.aliceUnread}_owner`,
          workspaceId,
          userId: 'usr_owner',
          role: 'owner'
        },
        {
          id: `mem_${ids.aliceUnread}_bob`,
          workspaceId,
          userId: 'usr_bob',
          role: 'member'
        }
      ])
      return slug
    })
  }

  function insertDatasetFor(
    workspaceId: string,
    ids: NotificationFeedContractDataset
  ): Effect.Effect<void, unknown, Database> {
    return Effect.gen(function* () {
      const db = yield* Database
      yield* db.insert(notifications).values({
        id: ids.aliceUnread,
        workspaceId,
        userId: 'usr_owner',
        title: 'Live row for the owner',
        message: 'Only the owner can see this row.',
        readAt: null,
        createdAt: '2026-06-10T06:00:00.000Z'
      })
    })
  }

  /** Drops a provisioned workspace; member and notification rows cascade. */
  function dropWorkspace(workspaceId: string): Effect.Effect<void, unknown, Database> {
    return Effect.gen(function* () {
      const db = yield* Database
      yield* db.delete(workspaces).where(eq(workspaces.id, workspaceId))
    })
  }

  it.effect('marks a user-targeted row read for its addressee', () => {
    const ids = freshIds()
    return Effect.flatMap(provisionActorWorkspace(ids), (slug) =>
      Effect.flatMap(insertDatasetFor(`wrk_${ids.aliceUnread}`, ids), () =>
        Effect.flatMap(
          inWorkspace(
            slug,
            Effect.gen(function* () {
              const feed = yield* NotificationFeed
              expect(yield* feed.markRead([ids.aliceUnread])).toBe(1)
              const rows = yield* feed.list
              expect(
                rows.find((notification) => notification.id === ids.aliceUnread)?.read
              ).toBe(true)
            }),
            { userId: 'usr_owner' }
          ),
          () => dropWorkspace(`wrk_${ids.aliceUnread}`)
        )
      )
    )
  })

  it.effect('another member cannot mark a row addressed to someone else', () => {
    const ids = freshIds()
    return Effect.flatMap(provisionActorWorkspace(ids), (slug) =>
      Effect.flatMap(insertDatasetFor(`wrk_${ids.aliceUnread}`, ids), () =>
        Effect.flatMap(
          inWorkspace(
            slug,
            Effect.gen(function* () {
              const feed = yield* NotificationFeed
              expect(yield* feed.markRead([ids.aliceUnread])).toBe(0)
            }),
            { userId: 'usr_bob' }
          ),
          () => dropWorkspace(`wrk_${ids.aliceUnread}`)
        )
      )
    )
  })
})
