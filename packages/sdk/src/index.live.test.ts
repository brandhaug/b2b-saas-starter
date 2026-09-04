import { apiTokens, notifications } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import {
  LIVE_SUITE_TIMEOUT,
  TestDatabase,
  TestD1
} from '@b2b-saas-starter/capabilities/testing/live-harness'
import { hashApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { expect, layer } from '@effect/vitest'
import { Effect } from 'effect'

import { buildWebHandler } from 'api/src/http.ts'
import { createStarterClient, type NotificationItem } from './index.ts'

/**
 * The SDK against the API worker in the live harness: one provisioned D1
 * (`packages/capabilities/src/testing/live-harness.ts`) backs the worker's
 * web handler, a real hashed API Token row authenticates the client, and the
 * paged walks run against actual D1 semantics — including the insert between
 * page fetches that keyset pagination exists to absorb (ADR 0057).
 *
 * Each test provides `TestDatabase` exactly once: the provision provisions a
 * fresh workerd D1, so the worker handler and the row inserts must draw from
 * the same build.
 */

const SDK_TOKEN = 'bsk_live_sdk_test_00000000'

/** One seeded feed for the live workspace, newest last in this array. */
const FEED: ReadonlyArray<NotificationItem> = [
  {
    id: 'not_sdk_1',
    title: 'One',
    message: 'one',
    createdAt: '2026-07-01T09:00:00.000Z',
    read: true
  },
  {
    id: 'not_sdk_2',
    title: 'Two',
    message: 'two',
    createdAt: '2026-07-02T09:00:00.000Z',
    read: true
  },
  {
    id: 'not_sdk_3',
    title: 'Three',
    message: 'three',
    createdAt: '2026-07-03T09:00:00.000Z',
    read: false
  },
  {
    id: 'not_sdk_4',
    title: 'Four',
    message: 'four',
    createdAt: '2026-07-04T09:00:00.000Z',
    read: false
  },
  {
    id: 'not_sdk_5',
    title: 'Five',
    message: 'five',
    createdAt: '2026-07-05T09:00:00.000Z',
    read: false
  }
]

/** The worker handler plus a client whose injected fetch rides it, over this
 * file's provisioned D1 and its `Database` service. */
const clientAndDb = Effect.gen(function* () {
  const d1 = yield* TestD1
  const db = yield* Database
  const { handler } = buildWebHandler({ DB: d1 })
  const client = createStarterClient({
    baseUrl: 'https://api.test',
    apiToken: SDK_TOKEN,
    fetch: (input, init) => handler(new Request(input, init))
  })
  return { client, db }
}).pipe(Effect.provide(TestDatabase))

/** Seeds the token + feed rows and returns the wired client. */
const insertFeed = Effect.gen(function* () {
  const { client, db } = yield* clientAndDb
  yield* db
    .insert(apiTokens)
    .values({
      id: 'tok_sdk_live',
      workspaceId: 'wrk_live',
      name: 'SDK live harness token',
      tokenPrefix: SDK_TOKEN.slice(0, 17),
      tokenHash: yield* Effect.promise(() => hashApiToken(SDK_TOKEN)),
      scopes: ['read'],
      lastUsedAt: null,
      revokedAt: null,
      createdAt: '2026-07-01T00:00:00.000Z'
    })
    // The harness's D1 is shared across this file's tests — re-seeding the
    // same token and feed rows must stay a no-op.
    .onConflictDoNothing()
  yield* db
    .insert(notifications)
    .values(
      FEED.map((notification) => ({
        id: notification.id,
        workspaceId: 'wrk_live',
        userId: null,
        title: notification.title,
        message: notification.message,
        readAt: readAtOf(notification),
        createdAt: notification.createdAt
      }))
    )
    .onConflictDoNothing()
  return { client, db }
})

function idsOf(page: { readonly items: ReadonlyArray<NotificationItem> }) {
  return page.items.map((notification) => notification.id)
}

function readAtOf(notification: {
  readonly read: boolean
  readonly createdAt: string
}): string | null {
  if (notification.read) {
    return notification.createdAt
  }
  return null
}

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'sdk against the live API worker',
  (it) => {
    it.effect('the injected token authenticates and pages live rows', () =>
      insertFeed.pipe(
        Effect.flatMap(({ client }) =>
          Effect.promise(() => client.workspace.notifications('live-lab', { limit: 2 }))
        ),
        Effect.map((first) => {
          expect(idsOf(first)).toEqual(['not_sdk_5', 'not_sdk_4'])
          expect(first.nextCursor).not.toBe(null)
          return first
        })
      )
    )

    it.effect('an insert between page fetches does not shift the unseen window', () =>
      insertFeed.pipe(
        Effect.flatMap(({ client, db }) =>
          Effect.gen(function* () {
            const first = yield* Effect.promise(() =>
              client.workspace.notifications('live-lab', { limit: 2 })
            )
            expect(idsOf(first)).toEqual(['not_sdk_5', 'not_sdk_4'])

            // A brand-new newest row lands between the two fetches. The
            // resumed page's keyset window stays frozen at the position the
            // first page ended on — no shift, no duplicate, no skip.
            yield* db.insert(notifications).values({
              id: 'not_sdk_inserted',
              workspaceId: 'wrk_live',
              userId: null,
              title: 'Inserted',
              message: 'between pages',
              readAt: null,
              createdAt: '2026-07-06T09:00:00.000Z'
            })

            const second = yield* Effect.promise(() =>
              client.workspace.notifications('live-lab', {
                limit: 10,
                cursor: first.nextCursor ?? undefined
              })
            )
            expect(idsOf(second)).toEqual(['not_sdk_3', 'not_sdk_2', 'not_sdk_1'])
            expect(second.nextCursor).toBe(null)

            // A fresh walk serves the inserted row first, then the untouched
            // original order — nothing the first page emitted moved.
            const fresh = yield* Effect.promise(() =>
              client.workspace.notifications('live-lab')
            )
            expect(idsOf(fresh)).toEqual([
              'not_sdk_inserted',
              'not_sdk_5',
              'not_sdk_4',
              'not_sdk_3',
              'not_sdk_2',
              'not_sdk_1'
            ])
          })
        )
      )
    )

    it.effect('the async iterator walks the whole live feed without duplicates', () =>
      insertFeed.pipe(
        Effect.flatMap(({ client }) =>
          // The iterator is promise-shaped by design; the walk below runs on
          // the async-iteration seam the SDK offers (see packages/sdk).
          // oxlint-disable-next-line effect/noAsyncFunction -- promise-shaped SDK surface; see sdk/src/index.ts
          Effect.promise(async () => {
            const walked: Array<string> = []
            for await (const notification of client.workspace.notifications.iterate(
              'live-lab',
              { limit: 2 }
            )) {
              walked.push(notification.id)
            }
            // Every feed row exactly once, in order — the exhaustion
            // guarantee — with no duplicate whatever earlier tests in this
            // file inserted after them.
            const feedIds = walked.filter((id) => FEED.some((row) => row.id === id))
            expect(feedIds).toEqual([
              'not_sdk_5',
              'not_sdk_4',
              'not_sdk_3',
              'not_sdk_2',
              'not_sdk_1'
            ])
            expect(new Set(walked).size).toBe(walked.length)
          })
        )
      )
    )
  }
)
