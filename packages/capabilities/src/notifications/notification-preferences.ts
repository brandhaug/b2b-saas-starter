import { notificationPreferences } from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { Context, DateTime, Effect, Layer, Ref, Schema } from 'effect'
import { eq } from 'drizzle-orm'

import { type CapabilityUnavailable } from '../errors.ts'
import {
  AuditEventLog,
  type RecordAuditEventInput
} from '../governance/audit-event-log.ts'
import { auditedMutations } from '../governance/audited-mutation.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  NOTIFICATION_KINDS,
  NotificationChannel,
  NotificationKind,
  defaultChannelFor,
  resolveChannel
} from './notification-kinds.ts'

/**
 * One resolved preference: the channel that applies to `kind` for the user,
 * and whether it is the kind's default or an explicit choice. `list` always
 * returns one entry per kind, so the UI renders the full matrix without
 * knowing the default policy.
 */
export const NotificationPreference = Schema.Struct({
  kind: NotificationKind,
  channel: NotificationChannel,
  isDefault: Schema.Boolean
})
export type NotificationPreference = typeof NotificationPreference.Type

export type SetNotificationPreferenceInput = {
  readonly userId: string
  readonly kind: NotificationKind
  readonly channel: NotificationChannel
}

/**
 * A stored (non-default) choice, as the Seed fixture and the D1 seed script
 * spell it. The wire shape derives from it plus the default policy.
 */
export type SeedNotificationPreference = {
  readonly userId: string
  readonly kind: NotificationKind
  readonly channel: NotificationChannel
}

/**
 * Identity-keyed on purpose: a preference belongs to a user across every
 * workspace they are a member of, so there is no `WorkspaceContext` to read.
 * Same family as `WorkspaceMembership.listWorkspacesForUser`.
 */
export type NotificationPreferencesInterface = {
  /** Every kind, resolved: explicit choices and defaults alike. */
  readonly list: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<NotificationPreference>, CapabilityUnavailable>
  /** The channel that applies to one kind for one user. */
  readonly resolve: (
    userId: string,
    kind: NotificationKind
  ) => Effect.Effect<NotificationChannel, CapabilityUnavailable>
  /**
   * Stores an explicit choice and records `notification_preference.changed`
   * against the user. Choosing the kind's default still stores a row: the
   * user said so, and the UI should keep showing it as chosen.
   */
  readonly set: (
    input: SetNotificationPreferenceInput
  ) => Effect.Effect<NotificationPreference, CapabilityUnavailable>
}

export class NotificationPreferences extends Context.Service<
  NotificationPreferences,
  NotificationPreferencesInterface
>()('@b2b-saas-starter/capabilities/NotificationPreferences') {}

/**
 * The full matrix for one user from whatever explicit rows exist. Shared by
 * both adapters so the "one entry per kind" shape is decided once.
 */
export function resolvePreferences(
  stored: ReadonlyMap<NotificationKind, NotificationChannel>
): ReadonlyArray<NotificationPreference> {
  return NOTIFICATION_KINDS.map((kind) => {
    const explicit = stored.get(kind)
    return {
      kind,
      channel: resolveChannel(kind, explicit),
      isDefault: explicit === undefined
    }
  })
}

/**
 * The audit event a preference change records. One builder for both adapters,
 * so the Seed layer and the batched Live write cannot drift.
 */
function preferenceChangeEvent(
  input: SetNotificationPreferenceInput
): RecordAuditEventInput {
  return {
    actorUserId: input.userId,
    actorType: 'user',
    eventType: 'notification_preference.changed',
    targetType: 'user',
    targetId: input.userId,
    metadata: {
      kind: input.kind,
      channel: input.channel,
      defaultChannel: defaultChannelFor(input.kind)
    }
  }
}

export function SeedNotificationPreferences(
  seed: ReadonlyArray<SeedNotificationPreference>
): Layer.Layer<NotificationPreferences, never, AuditEventLog> {
  return Layer.effect(NotificationPreferences)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const initial = new Map<string, Map<NotificationKind, NotificationChannel>>()
      for (const row of seed) {
        const byKind = initial.get(row.userId) ?? new Map()
        byKind.set(row.kind, row.channel)
        initial.set(row.userId, byKind)
      }
      const store = yield* Ref.make(initial)
      function storedFor(
        userId: string
      ): Effect.Effect<ReadonlyMap<NotificationKind, NotificationChannel>> {
        return Effect.map(Ref.get(store), (rows) => rows.get(userId) ?? new Map())
      }
      return {
        list: (userId) => Effect.map(storedFor(userId), resolvePreferences),
        resolve: (userId, kind) =>
          Effect.map(storedFor(userId), (stored) =>
            resolveChannel(kind, stored.get(kind))
          ),
        set: (input) =>
          Effect.gen(function* () {
            yield* Ref.update(store, (rows) => {
              const byKind = new Map(rows.get(input.userId))
              byKind.set(input.kind, input.channel)
              const next = new Map(rows)
              next.set(input.userId, byKind)
              return next
            })
            yield* audit.record(preferenceChangeEvent(input))
            return { kind: input.kind, channel: input.channel, isDefault: false }
          })
      }
    })
  )
}

const unavailable = orUnavailable('notification-preferences')

export const LiveNotificationPreferences: Layer.Layer<
  NotificationPreferences,
  never,
  Database | RawD1 | AuditEventLog
> = Layer.effect(NotificationPreferences)(
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog
    // The shared mutate+audit combinator: the upsert and its audit row commit
    // or roll back together, as every D1-writing audit-emitting capability does.
    const auditedMutation = yield* auditedMutations({
      prepareAuditRecord: audit.prepareRecord,
      unavailable
    })

    function storedFor(
      userId: string
    ): Effect.Effect<
      ReadonlyMap<NotificationKind, NotificationChannel>,
      CapabilityUnavailable
    > {
      return unavailable(
        db
          .select({
            kind: notificationPreferences.kind,
            channel: notificationPreferences.channel
          })
          .from(notificationPreferences)
          .where(eq(notificationPreferences.userId, userId))
      ).pipe(Effect.map((rows) => new Map(rows.map((row) => [row.kind, row.channel]))))
    }

    return {
      list: (userId) => Effect.map(storedFor(userId), resolvePreferences),
      resolve: (userId, kind) =>
        Effect.map(storedFor(userId), (stored) =>
          resolveChannel(kind, stored.get(kind))
        ),
      set: (input) =>
        Effect.gen(function* () {
          const id = yield* newCapabilityId('npref')
          const updatedAt = DateTime.formatIso(yield* DateTime.now)
          // One row per (user, kind): the unique index makes this an upsert,
          // batched with the audit insert.
          yield* auditedMutation({
            matched: Effect.succeed(true),
            auditEvent: preferenceChangeEvent(input),
            write: () =>
              db
                .insert(notificationPreferences)
                .values({
                  id,
                  userId: input.userId,
                  kind: input.kind,
                  channel: input.channel,
                  updatedAt
                })
                .onConflictDoUpdate({
                  target: [
                    notificationPreferences.userId,
                    notificationPreferences.kind
                  ],
                  set: { channel: input.channel, updatedAt }
                })
          })
          return { kind: input.kind, channel: input.channel, isDefault: false }
        })
    }
  })
)
