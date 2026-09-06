import { currentTraceparent } from '@b2b-saas-starter/logger'
import { seedKeysetPage } from '../internal/keyset-cursor.ts'
import { DateTime, Effect, Layer, Ref } from 'effect'

import { type Member, type Workspace } from '../governance/workspace-identity.ts'
import { AccountPreferencesService } from '../governance/account-preferences.ts'
import { type CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { seedMembers, seedWorkspaceRecord } from '../seed-fixture.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  enqueueInstantEmails,
  type EmailQueueRecipient
} from './notification-fan-out.ts'
import {
  inDigestWindow,
  NotificationFeed,
  visibleToActor,
  type CreateNotificationInput,
  type DigestCandidate,
  type Notification,
  type NotificationEmailContext,
  type NotificationFeedOptions,
  type NotifyUserInput,
  type NotifyWorkspaceOwnersInput,
  type SeedNotification
} from './notification-feed.ts'
import { NotificationPreferences } from './notification-preferences.ts'

/**
 * What the in-memory adapter needs to fan a broadcast out to its members: the
 * fixture workspace and its roster. `create` for any other workspace id still
 * persists the row, but has nobody to email — the fixture knows one workspace.
 * Defaults to the Seed Workspace, so a test that only reads or marks read can
 * pass the rows alone.
 */
type SeedNotificationFeedFixture = {
  readonly workspace: Workspace
  readonly members: ReadonlyArray<Member>
}

const defaultFixture: SeedNotificationFeedFixture = {
  workspace: seedWorkspaceRecord,
  members: seedMembers
}

/**
 * Seeded rows belong to whatever workspace is in context (the fixture is one
 * workspace); rows `create` adds carry the explicit id they were created for.
 */
type SeedRow = SeedNotification & { readonly workspaceId?: string }

function recipientOf(member: Member): EmailQueueRecipient {
  return {
    userId: member.id,
    email: member.email,
    name: member.name
  }
}

function inWorkspace(row: SeedRow, workspaceId: string): boolean {
  return row.workspaceId === undefined || row.workspaceId === workspaceId
}

function stripStorage(row: SeedRow): Notification {
  const base = {
    id: row.id,
    kind: row.kind,
    title: row.title,
    message: row.message,
    createdAt: row.createdAt,
    read: row.read
  }
  if (row.event !== undefined) {
    return { ...base, event: row.event }
  }
  return base
}

export function SeedNotificationFeed(
  seed: ReadonlyArray<SeedNotification>,
  fixture: SeedNotificationFeedFixture = defaultFixture,
  options: NotificationFeedOptions = {}
): Layer.Layer<
  NotificationFeed,
  never,
  NotificationPreferences | AccountPreferencesService
> {
  return Layer.effect(NotificationFeed)(
    Effect.gen(function* () {
      const preferences = yield* NotificationPreferences
      const accountPreferences = yield* AccountPreferencesService
      const rows = yield* Ref.make<ReadonlyArray<SeedRow>>([...seed])

      // Who a row reaches: its target user, or every member for a broadcast.
      // Unknown ids (a targeted user outside the roster, another workspace)
      // resolve to nobody, mirroring the Live joins.
      function recipientsOf(row: SeedRow): ReadonlyArray<EmailQueueRecipient> {
        if (!inWorkspace(row, fixture.workspace.id)) {
          return []
        }
        if (row.userId === undefined || row.userId === null) {
          return fixture.members.map(recipientOf)
        }
        const member = fixture.members.find((candidate) => candidate.id === row.userId)
        if (member === undefined) {
          return []
        }
        return [recipientOf(member)]
      }

      function withCurrentPreferences(
        recipient: EmailQueueRecipient
      ): Effect.Effect<EmailQueueRecipient, CapabilityUnavailable> {
        return Effect.map(accountPreferences.get(recipient.userId), (account) => ({
          ...recipient,
          locale: account.locale,
          timeZone: account.timeZone
        }))
      }

      function workspaceOf(row: SeedRow) {
        if (!inWorkspace(row, fixture.workspace.id)) {
          return null
        }
        return { slug: fixture.workspace.slug, name: fixture.workspace.name }
      }

      function contextFor(
        row: SeedRow,
        recipient: EmailQueueRecipient
      ): NotificationEmailContext {
        return {
          notification: stripStorage(row),
          recipient,
          workspace: workspaceOf(row)
        }
      }

      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const all = yield* Ref.get(rows)
          return all
            .filter(
              (row) =>
                inWorkspace(row, ctx.workspace.id) &&
                visibleToActor(row.userId, ctx.actor)
            )
            .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(stripStorage)
        }),
        listPage: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const all = yield* Ref.get(rows)
            // The shared keyset helper orders `(createdAt DESC, id DESC)` and
            // cuts the page over the same visible, stripped rows `list`
            // serves, so a page fetch behaves exactly like Live's ordered SQL
            // read.
            const visible: Array<Notification> = []
            for (const row of all) {
              if (
                inWorkspace(row, ctx.workspace.id) &&
                visibleToActor(row.userId, ctx.actor)
              ) {
                visible.push(stripStorage(row))
              }
            }
            return seedKeysetPage(
              visible,
              'desc',
              (row) => ({ key: row.createdAt, id: row.id }),
              input
            )
          }),
        unreadCount: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const all = yield* Ref.get(rows)
          return all.filter(
            (row) =>
              inWorkspace(row, ctx.workspace.id) &&
              !row.read &&
              visibleToActor(row.userId, ctx.actor)
          ).length
        }),
        markRead: (ids) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const requested = new Set(ids)
            // `Ref.modify`, not `Ref.update` + a closure counter: modify runs
            // its function exactly once per successful state transition, so
            // the returned count is the transition's own answer.
            return yield* Ref.modify(rows, (current) => {
              let marked = 0
              const next = current.map((row) => {
                if (
                  !requested.has(row.id) ||
                  !inWorkspace(row, ctx.workspace.id) ||
                  !visibleToActor(row.userId, ctx.actor) ||
                  row.read
                ) {
                  return row
                }
                marked += 1
                return { ...row, read: true }
              })
              return [marked, next]
            })
          }),
        create: (input: CreateNotificationInput) =>
          Effect.gen(function* () {
            const id = yield* newCapabilityId('not')
            const createdAt = DateTime.formatIso(yield* DateTime.now)
            const row: SeedRow = {
              id,
              workspaceId: input.workspaceId,
              userId: input.userId ?? null,
              kind: input.kind,
              title: input.title,
              message: input.message,
              event: input.event,
              createdAt,
              read: false
            }
            yield* Ref.update(rows, (all) => [...all, row])
            const traceparent = yield* currentTraceparent
            yield* enqueueInstantEmails(options.emailQueue, preferences, {
              notificationId: id,
              kind: input.kind,
              recipients: recipientsOf(row),
              traceparent
            })
            return stripStorage(row)
          }),
        record: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const row: SeedRow = {
              id: yield* newCapabilityId('not'),
              workspaceId: ctx.workspace.id,
              // The failed-test notice is a plain feed message: no kind-driven
              // email fan-out, no preferences consultation.
              kind: 'announcement',
              title: input.title,
              message: input.message,
              event: input.event,
              createdAt: DateTime.formatIso(yield* DateTime.now),
              read: false,
              userId: input.userId
            }
            yield* Ref.update(rows, (all) => [...all, row])
          }),
        notifyUser: (input: NotifyUserInput) =>
          Effect.gen(function* () {
            // The fixture is one workspace with one roster, so "every
            // workspace the user is a member of" collapses to the fixture
            // workspace when the user is on the roster — and to nothing (no
            // row, no email) when they are not, mirroring the Live join.
            const member = fixture.members.find(
              (candidate) => candidate.id === input.userId
            )
            if (member === undefined) {
              return
            }
            const row: SeedRow = {
              id: yield* newCapabilityId('not'),
              workspaceId: fixture.workspace.id,
              userId: input.userId,
              kind: input.kind,
              title: input.title,
              message: input.message,
              event: input.event,
              createdAt: DateTime.formatIso(yield* DateTime.now),
              read: false
            }
            yield* Ref.update(rows, (all) => [...all, row])
            const traceparent = yield* currentTraceparent
            yield* enqueueInstantEmails(options.emailQueue, preferences, {
              notificationId: row.id,
              kind: input.kind,
              recipients: [recipientOf(member)],
              traceparent
            })
          }),
        notifyWorkspaceOwners: (input: NotifyWorkspaceOwnersInput) =>
          Effect.gen(function* () {
            // Owners of the fixture workspace, straight off the roster — the
            // same filter Live applies to `workspace_members`. Any other
            // workspace id owns no rows here (the fixture knows one), so the
            // call records nothing, mirroring Live's empty join.
            if (input.workspaceId !== fixture.workspace.id) {
              return
            }
            const owners = fixture.members.filter((member) => member.role === 'owner')
            if (owners.length === 0) {
              return
            }
            const createdAt = DateTime.formatIso(yield* DateTime.now)
            const created: Array<{ row: SeedRow; owner: EmailQueueRecipient }> = []
            for (const owner of owners) {
              created.push({
                owner: recipientOf(owner),
                row: {
                  id: yield* newCapabilityId('not'),
                  workspaceId: input.workspaceId,
                  userId: owner.id,
                  kind: input.kind,
                  title: input.title,
                  message: input.message,
                  event: input.event,
                  createdAt,
                  read: false
                }
              })
            }
            // One store write for all rows, mirroring Live's single insert.
            yield* Ref.update(rows, (all) => [...all, ...created.map(({ row }) => row)])
            // One enqueue per row: a notification id addresses one (row,
            // recipient) pair, exactly like the Live fan-out.
            const traceparent = yield* currentTraceparent
            for (const { row, owner } of created) {
              yield* enqueueInstantEmails(options.emailQueue, preferences, {
                notificationId: row.id,
                kind: input.kind,
                recipients: [owner],
                traceparent
              })
            }
          }),
        loadForEmail: (notificationId, recipientUserId) =>
          Effect.gen(function* () {
            const all = yield* Ref.get(rows)
            const row = all.find((candidate) => candidate.id === notificationId)
            if (row === undefined || row.read) {
              return null
            }
            const recipients = recipientsOf(row)
            const recipient = recipients.find(
              (candidate) => candidate.userId === recipientUserId
            )
            if (recipient === undefined) {
              return null
            }
            return contextFor(row, yield* withCurrentPreferences(recipient))
          }),
        listDigestCandidates: (window) =>
          Effect.gen(function* () {
            const all = yield* Ref.get(rows)
            const candidates: Array<DigestCandidate> = []
            for (const row of all) {
              if (row.read || !inDigestWindow(row.createdAt, window)) {
                continue
              }
              const recipients = yield* Effect.forEach(
                recipientsOf(row),
                withCurrentPreferences,
                { concurrency: 'unbounded' }
              )
              candidates.push(
                ...recipients.map((recipient) => contextFor(row, recipient))
              )
            }
            return candidates
          })
      }
    })
  )
}
