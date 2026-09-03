import { Effect } from 'effect'
import { type ContractExpectMatchers } from '../governance/contract-expect.ts'
import { type CapabilityUnavailable } from '../errors.ts'
import { NotificationFeed, type SeedNotification } from './notification-feed.ts'
import { type WorkspaceContext } from '../workspace-context.ts'

/**
 * The notification feed contract, written once and run against both adapters —
 * capabilities invariant 4, the same shape as the audit / membership /
 * invitation / lifecycle contracts.
 *
 * Each case carries the dataset it needs: three rows — one unread broadcast,
 * one already-read broadcast, one unread row addressed to `usr_alice` — so the
 * cases are order-independent. Seed rebuilds the fixture per test; the Live
 * suite mints unique row ids against persistent D1 per case.
 */

export type NotificationFeedContractDataset = {
  /** Unread, visible to every actor (userId NULL). */
  readonly broadcastUnread: string
  /** Already read — marking it again must change nothing. */
  readonly broadcastRead: string
  /** Unread and addressed to another user, so an actorless context never sees it. */
  readonly aliceUnread: string
}

export function notificationFeedContractDataset(
  ids: NotificationFeedContractDataset
): ReadonlyArray<SeedNotification> {
  return [
    {
      id: ids.broadcastUnread,
      title: 'Broadcast needs attention',
      message: 'An unread workspace broadcast.',
      createdAt: '2026-06-10T08:00:00.000Z',
      read: false
    },
    {
      id: ids.broadcastRead,
      title: 'Already read broadcast',
      message: 'A broadcast that was read before the case ran.',
      createdAt: '2026-06-10T07:00:00.000Z',
      read: true
    },
    {
      id: ids.aliceUnread,
      userId: 'usr_alice',
      title: 'Addressed to Alice',
      message: 'Only Alice can see this row.',
      createdAt: '2026-06-10T06:00:00.000Z',
      read: false
    }
  ]
}

export type NotificationFeedContractCase = {
  readonly name: string
  /** The rows this case needs; each adapter installs them before the assert. */
  readonly dataset: NotificationFeedContractDataset
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable,
    NotificationFeed | WorkspaceContext
  >
}

/** The slice of vitest's `expect` these cases use — see the lifecycle contract. */
export type ContractExpect = <A>(
  actual: A
) => Pick<ContractExpectMatchers<A>, 'toBe' | 'toEqual'>

export function notificationFeedContractCases(
  freshIds: () => NotificationFeedContractDataset,
  expect: ContractExpect
): ReadonlyArray<NotificationFeedContractCase> {
  // Each case mints its own dataset: the cases mutate the feed, so one shared
  // dataset would let case order decide the outcome.
  function caseWith(
    name: string,
    build: (
      ids: NotificationFeedContractDataset
    ) => NotificationFeedContractCase['assert']
  ): NotificationFeedContractCase {
    const dataset = freshIds()
    return { name, dataset, assert: build(dataset) }
  }
  return [
    caseWith('marks an unread visible row read and reports one change', (ids) =>
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        expect(yield* feed.markRead([ids.broadcastUnread])).toBe(1)
        const read = (yield* feed.list).find(
          (notification) => notification.id === ids.broadcastUnread
        )
        expect(read?.read).toBe(true)
      })
    ),
    caseWith('is idempotent — the same ids change nothing the second time', (ids) =>
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        expect(yield* feed.markRead([ids.broadcastUnread])).toBe(1)
        expect(yield* feed.markRead([ids.broadcastUnread])).toBe(0)
      })
    ),
    caseWith('ignores unknown and already-read ids', (ids) =>
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        expect(yield* feed.markRead(['not_missing', ids.broadcastRead])).toBe(0)
      })
    ),
    caseWith('never stamps rows the context cannot see', (ids) =>
      Effect.gen(function* () {
        // The row addressed to usr_alice is invisible in an actorless
        // context; marking it must change nothing.
        const feed = yield* NotificationFeed
        expect(yield* feed.markRead([ids.aliceUnread])).toBe(0)
      })
    ),
    caseWith('drops the unread count by exactly the rows marked', (ids) =>
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        const before = yield* feed.unreadCount
        expect(yield* feed.markRead([ids.broadcastUnread, ids.broadcastRead])).toBe(1)
        expect(yield* feed.unreadCount).toBe(before - 1)
      })
    ),
    // Paging (ADR 0054): the REST/MCP list surface reads the same store
    // through listPage, newest-first on (createdAt DESC, id DESC), with the
    // visibility filter applied to every page — the row addressed to another
    // user is invisible here and so appears on no page.
    caseWith(
      'pages newest-first over the visible rows and stops at exhaustion',
      (ids) =>
        Effect.gen(function* () {
          const feed = yield* NotificationFeed
          const walked: Array<string> = []
          // Annotated: the cursor's type must not be inferred from the page
          // result, or the loop's initializer would reference itself.
          let cursor: string | null = null
          let continueWalking = true
          for (let guard = 0; guard < 10 && continueWalking; guard += 1) {
            const page: {
              readonly items: ReadonlyArray<{ readonly id: string }>
              readonly nextCursor: string | null
            } = yield* feed.listPage({
              limit: 1,
              cursor: cursor ?? undefined
            })
            for (const notification of page.items) {
              walked.push(notification.id)
            }
            cursor = page.nextCursor
            continueWalking = cursor !== null
          }
          expect(walked).toEqual([ids.broadcastUnread, ids.broadcastRead])
        })
    ),
    caseWith('an undecodable cursor addresses no position', () =>
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        const page = yield* feed.listPage({ cursor: 'not-a-cursor' })
        expect(page.items).toEqual([])
        expect(page.nextCursor).toBe(null)
      })
    ),
    caseWith('limit clamps into the shared range', () =>
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        // Zero clamps up to one row; the default covers both visible rows
        // and names no next page.
        const zero = yield* feed.listPage({ limit: 0 })
        expect(zero.items.length).toBe(1)
        const whole = yield* feed.listPage()
        expect(whole.items.length).toBe(2)
        expect(whole.nextCursor).toBe(null)
      })
    )
  ]
}
