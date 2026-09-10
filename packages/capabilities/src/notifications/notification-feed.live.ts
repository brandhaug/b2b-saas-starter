import { currentTraceparent } from '@b2b-saas-starter/logger'
import { Database } from '@b2b-saas-starter/db/service'
import {
  notifications,
  user,
  workspaceMembers,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { DateTime, Effect, Layer, Schema } from 'effect'
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL
} from 'drizzle-orm'
import { clampPageLimit, cutKeysetPage } from '../internal/keyset-cursor.ts'
import { keysetResume } from '../internal/keyset-query.ts'

import {
  CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import { newCapabilityId } from '../internal/ids.ts'

import { WorkspaceContext, type Actor } from '../workspace-context.ts'
import {
  enqueueInstantEmails,
  type EmailQueueRecipient
} from './notification-fan-out.ts'
import {
  NotificationFeed,
  type DigestWindow,
  type Notification,
  type NotificationEmailContext,
  type NotifyWorkspaceOwnersInput,
  type PreparedNotificationCondition,
  type PreparedWorkspaceOwnerNotifications,
  type NotificationFeedOptions,
  type NotificationWorkspace
} from './notification-feed.ts'
import { NotificationEventSchema } from './notification-events.ts'
import { NotificationPreferences } from './notification-preferences.ts'

type NotificationRow = typeof notifications.$inferSelect
type UserRow = typeof user.$inferSelect
type WorkspaceRow = typeof workspaces.$inferSelect

const decodeNotificationEvent = Schema.decodeUnknownOption(NotificationEventSchema)
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

function toNotification(row: NotificationRow): Notification {
  const base = {
    id: row.id,
    kind: row.kind,
    title: row.title,
    message: row.message,
    createdAt: row.createdAt,
    read: row.readAt !== null
  }
  if (row.event !== null) {
    const event = decodeNotificationEvent(row.event)
    if (event._tag === 'Some') {
      return {
        ...base,
        event: event.value
      }
    }
  }
  return base
}

function toRecipient(row: UserRow): EmailQueueRecipient {
  return {
    userId: row.id,
    email: row.email,
    name: row.name,
    locale: row.locale,
    timeZone: row.timeZone
  }
}

function toWorkspaceRef(row: WorkspaceRow | null): NotificationWorkspace | null {
  if (row === null) {
    return null
  }
  return { id: row.id, slug: row.slug, name: row.name }
}

// Broadcast rows (userId IS NULL) are visible to everyone in the workspace;
// user-targeted rows only to that actor. Without an actor in context, only
// broadcast rows are visible.
function visibilityFilter(workspaceId: string, actor: Actor | null) {
  const workspaceScope = eq(notifications.workspaceId, workspaceId)
  if (actor === null) {
    return and(workspaceScope, isNull(notifications.userId))
  }
  return and(
    workspaceScope,
    or(isNull(notifications.userId), eq(notifications.userId, actor.userId))
  )
}

/** Unread rows created inside `[since, until)`. */
function digestFilter(window: DigestWindow) {
  return and(
    isNull(notifications.readAt),
    gte(notifications.createdAt, window.since),
    lt(notifications.createdAt, window.until)
  )
}

const unavailable = orUnavailable('notification-feed')

export function LiveNotificationFeed(
  options: NotificationFeedOptions = {}
): Layer.Layer<NotificationFeed, never, Database | NotificationPreferences> {
  return Layer.effect(NotificationFeed)(
    Effect.gen(function* () {
      const db = yield* Database
      const preferences = yield* NotificationPreferences

      /** Every member of a workspace, as email recipients. */
      function membersOf(
        workspaceId: string
      ): Effect.Effect<ReadonlyArray<EmailQueueRecipient>, CapabilityUnavailable> {
        return unavailable(
          db
            .select({ user })
            .from(workspaceMembers)
            .innerJoin(user, eq(user.id, workspaceMembers.userId))
            .where(eq(workspaceMembers.workspaceId, workspaceId))
        ).pipe(Effect.map((rows) => rows.map((row) => toRecipient(row.user))))
      }

      /** The workspace's owners, as email recipients. */
      function ownersOf(
        workspaceId: string,
        audience: 'owners' | 'owners_and_admins' = 'owners'
      ): Effect.Effect<ReadonlyArray<EmailQueueRecipient>, CapabilityUnavailable> {
        let roleCondition = eq(workspaceMembers.role, 'owner')
        if (audience === 'owners_and_admins') {
          roleCondition = inArray(workspaceMembers.role, ['owner', 'admin'])
        }
        return unavailable(
          db
            .select({ user })
            .from(workspaceMembers)
            .innerJoin(user, eq(user.id, workspaceMembers.userId))
            .where(and(eq(workspaceMembers.workspaceId, workspaceId), roleCondition))
        ).pipe(Effect.map((rows) => rows.map((row) => toRecipient(row.user))))
      }

      /** The one user a targeted row reaches, if the account still exists. */
      function userById(
        userId: string
      ): Effect.Effect<EmailQueueRecipient | null, CapabilityUnavailable> {
        return unavailable(db.select().from(user).where(eq(user.id, userId))).pipe(
          Effect.map((rows) => {
            const row = rows[0]
            if (row === undefined) {
              return null
            }
            return toRecipient(row)
          })
        )
      }

      /**
       * Who may receive `row` by email: its target user, or the workspace's
       * members for a broadcast. A row with no workspace and no user reaches
       * nobody.
       */
      function recipientsOf(
        row: Pick<NotificationRow, 'workspaceId' | 'userId'>
      ): Effect.Effect<ReadonlyArray<EmailQueueRecipient>, CapabilityUnavailable> {
        if (row.userId !== null) {
          return Effect.map(userById(row.userId), (recipient) => {
            if (recipient === null) {
              return []
            }
            return [recipient]
          })
        }
        if (row.workspaceId === null) {
          return Effect.succeed([])
        }
        return membersOf(row.workspaceId)
      }

      const prepareOwners = Effect.fn('NotificationFeed.prepareOwners')(function* (
        input: NotifyWorkspaceOwnersInput
      ) {
        const owners = yield* ownersOf(input.workspaceId, input.audience)
        const createdAt = DateTime.formatIso(yield* DateTime.now)
        // One targeted row per owner, each visible only to its reader —
        // the same shape `notifyUser` writes, resolved from the workspace
        // the background producer holds.
        const created: Array<{
          row: NotificationRow
          owner: EmailQueueRecipient
        }> = []
        for (const owner of owners) {
          created.push({
            owner,
            row: {
              id: yield* newCapabilityId('not'),
              workspaceId: input.workspaceId,
              userId: owner.userId,
              kind: input.kind,
              title: input.title,
              message: input.message,
              event: input.event ?? null,
              readAt: null,
              createdAt
            }
          })
        }
        return {
          created,
          publish: Effect.gen(function* () {
            // One enqueue per row: a notification id addresses one (row,
            // recipient) pair, so each owner's email resolves against their
            // own channel preference.
            const traceparent = yield* currentTraceparent
            for (const { row, owner } of created) {
              yield* enqueueInstantEmails(options.emailQueue, preferences, {
                notificationId: row.id,
                kind: input.kind,
                recipients: [owner],
                traceparent
              })
            }
          })
        }
      })

      const prepareWorkspaceOwners = Effect.fn(
        'NotificationFeed.prepareWorkspaceOwners'
      )(function* (
        input: NotifyWorkspaceOwnersInput,
        condition?: PreparedNotificationCondition
      ): Effect.fn.Return<PreparedWorkspaceOwnerNotifications, CapabilityUnavailable> {
        const prepared = yield* prepareOwners(input)
        const writes = prepared.created.map(({ row }) =>
          db.insert(notifications).select(
            db
              .select({
                id: sql<string>`${row.id}`.as('id'),
                workspaceId: sql<string | null>`${row.workspaceId}`.as('workspaceId'),
                userId: sql<string | null>`${row.userId}`.as('userId'),
                kind: sql`${row.kind}`.as('kind'),
                title: sql<string>`${row.title}`.as('title'),
                message: sql<string>`${row.message}`.as('message'),
                event: sql`${encodeJson(row.event)}`.as('event'),
                readAt: sql<string | null>`NULL`.as('readAt'),
                createdAt: sql<string>`${row.createdAt}`.as('createdAt')
              })
              .from(sql`(select 1)`)
              .where(condition?.sql)
          )
        )
        // The rows ride the producer's batch, so there is nothing left to
        // commit here; Seed's counterpart carries its write instead.
        return { writes, commit: Effect.void, publish: prepared.publish }
      })

      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select()
              .from(notifications)
              .where(visibilityFilter(ctx.workspace.id, ctx.actor))
              .orderBy(desc(notifications.createdAt))
          )
          return rows.map(toNotification)
        }),
        listPage: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const limit = clampPageLimit(input?.limit)
            const conditions: Array<SQL | undefined> = [
              visibilityFilter(ctx.workspace.id, ctx.actor)
            ]
            // The SQL half of the keyset recipe lives in `keyset-query.ts`,
            // shared with every other paged Live read.
            const resume = keysetResume(
              'desc',
              { key: notifications.createdAt, id: notifications.id },
              input?.cursor
            )
            if (resume.kind === 'empty') {
              return { items: [], nextCursor: null }
            }
            if (resume.kind === 'resume') {
              conditions.push(resume.condition)
            }
            // One row past the page cap, so `cutKeysetPage` can see whether
            // the cap actually cut rows off before offering a cursor.
            const rows = yield* unavailable(
              db
                .select()
                .from(notifications)
                .where(and(...conditions))
                .orderBy(desc(notifications.createdAt), desc(notifications.id))
                .limit(limit + 1)
            )
            return cutKeysetPage(rows.map(toNotification), limit, (row) => ({
              key: row.createdAt,
              id: row.id
            }))
          }),
        unreadCount: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select({ value: count() })
              .from(notifications)
              .where(
                and(
                  visibilityFilter(ctx.workspace.id, ctx.actor),
                  isNull(notifications.readAt)
                )
              )
          )
          return rows[0]?.value ?? 0
        }),
        markRead: (ids) =>
          Effect.gen(function* () {
            if (ids.length === 0) {
              return 0
            }
            const ctx = yield* WorkspaceContext
            const readAt = yield* DateTime.now
            // The visibility filter scopes the write exactly like the read: an
            // id the actor cannot see is never stamped. One statement, and
            // the rows it returns are the count — a select-then-update pair
            // would report rows another request stamped in between.
            const stamped = yield* unavailable(
              db
                .update(notifications)
                .set({ readAt: DateTime.formatIso(readAt) })
                .where(
                  and(
                    visibilityFilter(ctx.workspace.id, ctx.actor),
                    isNull(notifications.readAt),
                    inArray(notifications.id, [...ids])
                  )
                )
                .returning({ id: notifications.id })
            )
            return stamped.length
          }),
        create: (input) =>
          Effect.gen(function* () {
            let id: string
            if (input.deduplicationKey === undefined) {
              id = yield* newCapabilityId('not')
            } else {
              id = `not:${input.workspaceId}:${input.userId ?? 'broadcast'}:${input.deduplicationKey}`
            }
            const createdAt = DateTime.formatIso(yield* DateTime.now)
            const row: NotificationRow = {
              id,
              workspaceId: input.workspaceId,
              userId: input.userId ?? null,
              kind: input.kind,
              title: input.title,
              message: input.message,
              event: input.event ?? null,
              readAt: null,
              createdAt
            }
            const inserted = yield* unavailable(
              db
                .insert(notifications)
                .values(row)
                .onConflictDoNothing({ target: notifications.id })
                .returning()
            )
            if (inserted.length === 0) {
              const existing = yield* unavailable(
                db.select().from(notifications).where(eq(notifications.id, id)).limit(1)
              )
              const stored = existing[0]
              if (stored !== undefined) {
                return toNotification(stored)
              }
              // Inserted nothing and found nothing: the row was deleted
              // between the two statements. Unavailable, stated directly —
              // laundering a bare string through `orUnavailable` hides which
              // capability is answering.
              return yield* new CapabilityUnavailable({
                capability: 'notification-feed',
                reason: 'notification_disappeared'
              })
            }
            const recipients = yield* recipientsOf(row)
            const traceparent = yield* currentTraceparent
            yield* enqueueInstantEmails(options.emailQueue, preferences, {
              notificationId: id,
              kind: input.kind,
              recipients,
              traceparent
            })
            return toNotification(row)
          }),
        record: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const createdAt = DateTime.formatIso(yield* DateTime.now)
            // The failed-test notice is a plain feed message: no kind-driven
            // email fan-out, no preferences consultation.
            yield* unavailable(
              db.insert(notifications).values({
                id: yield* newCapabilityId('not'),
                workspaceId: ctx.workspace.id,
                userId: input.userId,
                kind: 'announcement',
                title: input.title,
                message: input.message,
                event: input.event ?? null,
                readAt: null,
                createdAt
              })
            )
          }),
        notifyUser: (input) =>
          Effect.gen(function* () {
            const memberships = yield* unavailable(
              db
                .select({ workspaceId: workspaceMembers.workspaceId })
                .from(workspaceMembers)
                .where(eq(workspaceMembers.userId, input.userId))
            )
            if (memberships.length === 0) {
              return
            }
            const createdAt = DateTime.formatIso(yield* DateTime.now)
            const rows: Array<NotificationRow> = []
            for (const membership of memberships) {
              rows.push({
                id: yield* newCapabilityId('not'),
                workspaceId: membership.workspaceId,
                userId: input.userId,
                kind: input.kind,
                title: input.title,
                message: input.message,
                event: input.event ?? null,
                readAt: null,
                createdAt
              })
            }
            // `memberships.length === 0` returned above, so the insert is
            // never empty — but say it in code, not in a non-null assertion.
            const [firstRow] = rows
            if (firstRow === undefined) {
              return
            }
            yield* unavailable(db.insert(notifications).values(rows))
            // One event, one email: the extra rows are feed copies across the
            // user's other workspaces, not additional messages. Channel
            // resolution stays with the fan-out helper.
            const recipient = yield* userById(input.userId)
            const recipients: Array<EmailQueueRecipient> = []
            if (recipient !== null) {
              recipients.push(recipient)
            }
            const traceparent = yield* currentTraceparent
            yield* enqueueInstantEmails(options.emailQueue, preferences, {
              notificationId: firstRow.id,
              kind: input.kind,
              recipients,
              traceparent
            })
          }),
        prepareWorkspaceOwners,
        notifyWorkspaceOwners: (input) =>
          Effect.gen(function* () {
            const prepared = yield* prepareOwners(input)
            if (prepared.created.length === 0) {
              return
            }
            yield* unavailable(
              db.insert(notifications).values(prepared.created.map(({ row }) => row))
            )
            yield* prepared.publish
          }),
        loadForEmail: (notificationId, recipientUserId) =>
          Effect.gen(function* () {
            const rows = yield* unavailable(
              db
                .select({ notification: notifications, workspace: workspaces })
                .from(notifications)
                .leftJoin(workspaces, eq(workspaces.id, notifications.workspaceId))
                .where(eq(notifications.id, notificationId))
            )
            const found = rows[0]
            // Read since it was enqueued: the recipient has already seen it.
            if (found === undefined || found.notification.readAt !== null) {
              return null
            }
            const recipients = yield* recipientsOf(found.notification)
            const recipient = recipients.find(
              (candidate) => candidate.userId === recipientUserId
            )
            if (recipient === undefined) {
              return null
            }
            const context: NotificationEmailContext = {
              notification: toNotification(found.notification),
              recipient,
              workspace: toWorkspaceRef(found.workspace)
            }
            return context
          }),
        listDigestCandidates: (window) =>
          Effect.gen(function* () {
            // Two shapes of row, two joins: a targeted row reaches its user,
            // a broadcast row reaches every member of its workspace. The
            // joins are independent — run them together.
            const [targeted, broadcast] = yield* Effect.all(
              [
                unavailable(
                  db
                    .select({
                      notification: notifications,
                      user,
                      workspace: workspaces
                    })
                    .from(notifications)
                    .innerJoin(user, eq(user.id, notifications.userId))
                    .leftJoin(workspaces, eq(workspaces.id, notifications.workspaceId))
                    .where(and(digestFilter(window), isNotNull(notifications.userId)))
                ),
                unavailable(
                  db
                    .select({
                      notification: notifications,
                      user,
                      workspace: workspaces
                    })
                    .from(notifications)
                    .innerJoin(workspaces, eq(workspaces.id, notifications.workspaceId))
                    .innerJoin(
                      workspaceMembers,
                      eq(workspaceMembers.workspaceId, notifications.workspaceId)
                    )
                    .innerJoin(user, eq(user.id, workspaceMembers.userId))
                    .where(and(digestFilter(window), isNull(notifications.userId)))
                )
              ],
              { discard: false }
            )
            return [...targeted, ...broadcast].map((row) => ({
              notification: toNotification(row.notification),
              recipient: toRecipient(row.user),
              workspace: toWorkspaceRef(row.workspace)
            }))
          })
      }
    })
  )
}
