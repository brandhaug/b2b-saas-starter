import {
  account,
  notifications,
  passkey,
  session,
  user
} from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { Context, Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import {
  CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import { WorkspaceMembership } from './workspace-membership.ts'
import { AccountPreferencesService } from './account-preferences.ts'
import { NotificationPreferences } from '../notifications/notification-preferences.ts'

export const PersonalDataExport = Schema.Struct({
  generatedAt: Schema.String,
  user: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
    image: Schema.NullOr(Schema.String),
    username: Schema.NullOr(Schema.String),
    displayUsername: Schema.NullOr(Schema.String),
    emailVerified: Schema.Boolean,
    locale: Schema.NullOr(Schema.String),
    timeZone: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
    updatedAt: Schema.String
  }),
  workspaces: Schema.Array(Schema.Unknown),
  accountPreferences: Schema.Struct({
    locale: Schema.NullOr(Schema.String),
    timeZone: Schema.NullOr(Schema.String)
  }),
  notificationPreferences: Schema.Array(Schema.Unknown),
  notifications: Schema.Array(Schema.Unknown),
  sessions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      expiresAt: Schema.String,
      createdAt: Schema.String,
      updatedAt: Schema.String,
      ipAddress: Schema.NullOr(Schema.String),
      userAgent: Schema.NullOr(Schema.String)
    })
  ),
  linkedAccounts: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      providerId: Schema.String,
      issuer: Schema.String,
      accountId: Schema.String,
      createdAt: Schema.String,
      updatedAt: Schema.String
    })
  ),
  passkeys: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.NullOr(Schema.String),
      credentialID: Schema.String,
      deviceType: Schema.String,
      backedUp: Schema.Boolean,
      transports: Schema.NullOr(Schema.String),
      createdAt: Schema.String
    })
  )
})
export type PersonalDataExport = typeof PersonalDataExport.Type

export type PersonalDataExportInterface = {
  readonly collect: (
    userId: string
  ) => Effect.Effect<PersonalDataExport, CapabilityUnavailable>
}

export class PersonalDataExports extends Context.Service<
  PersonalDataExports,
  PersonalDataExportInterface
>()('@b2b-saas-starter/capabilities/PersonalDataExports') {}

export function renderPersonalDataExport(data: PersonalDataExport): string {
  // oxlint-disable-next-line effect/noGlobals -- JSON is the documented archive format.
  return `${JSON.stringify({ schemaVersion: 1, readme: 'Personal account data export. Secrets, credentials, authentication tokens, and other users data are excluded.', ...data }, null, 2)}\n`
}

export function SeedPersonalDataExports(
  userIds: ReadonlyArray<string>
): Layer.Layer<
  PersonalDataExports,
  never,
  WorkspaceMembership | AccountPreferencesService | NotificationPreferences
> {
  return Layer.effect(PersonalDataExports)(
    Effect.gen(function* () {
      const membership = yield* WorkspaceMembership
      const accountPreferences = yield* AccountPreferencesService
      const preferences = yield* NotificationPreferences
      return {
        collect: (userId) =>
          Effect.gen(function* () {
            if (!userIds.includes(userId)) {
              return yield* new CapabilityUnavailable({
                capability: 'personal-data-export',
                reason: 'user_not_found'
              })
            }
            const workspaces = yield* membership.listWorkspacesForUser(userId)
            const accountPrefs = yield* accountPreferences.get(userId)
            const notificationPreferences = yield* preferences.list(userId)
            const member = workspaces[0]?.member
            return {
              // oxlint-disable-next-line effect/noGlobals -- seed adapter has no platform clock; this is informational only.
              generatedAt: new Date().toISOString(),
              user: {
                id: userId,
                name: member?.name ?? userId,
                email: member?.email ?? '',
                image: null,
                username: null,
                displayUsername: null,
                emailVerified: false,
                locale: accountPrefs.locale,
                timeZone: accountPrefs.timeZone,
                createdAt: '',
                updatedAt: ''
              },
              workspaces,
              accountPreferences: accountPrefs,
              notificationPreferences,
              notifications: [],
              sessions: [],
              linkedAccounts: [],
              passkeys: []
            }
          })
      }
    })
  )
}

const unavailable = orUnavailable('personal-data-export')
export const LivePersonalDataExports: Layer.Layer<
  PersonalDataExports,
  never,
  | Database
  | RawD1
  | WorkspaceMembership
  | AccountPreferencesService
  | NotificationPreferences
> = Layer.effect(PersonalDataExports)(
  Effect.gen(function* () {
    const db = yield* Database
    const membership = yield* WorkspaceMembership
    const accountPreferences = yield* AccountPreferencesService
    const preferences = yield* NotificationPreferences
    return {
      collect: (userId) =>
        Effect.gen(function* () {
          const [
            users,
            workspaces,
            accountPrefs,
            notificationPrefs,
            noticeRows,
            sessions,
            accounts,
            passkeys
          ] = yield* Effect.all(
            [
              unavailable(db.select().from(user).where(eq(user.id, userId)).limit(1)),
              membership.listWorkspacesForUser(userId),
              accountPreferences.get(userId),
              preferences.list(userId),
              unavailable(
                db
                  .select({
                    id: notifications.id,
                    workspaceId: notifications.workspaceId,
                    kind: notifications.kind,
                    title: notifications.title,
                    message: notifications.message,
                    readAt: notifications.readAt,
                    createdAt: notifications.createdAt
                  })
                  .from(notifications)
                  .where(eq(notifications.userId, userId))
              ),
              unavailable(
                db
                  .select({
                    id: session.id,
                    expiresAt: session.expiresAt,
                    createdAt: session.createdAt,
                    updatedAt: session.updatedAt,
                    ipAddress: session.ipAddress,
                    userAgent: session.userAgent
                  })
                  .from(session)
                  .where(eq(session.userId, userId))
              ),
              unavailable(
                db
                  .select({
                    id: account.id,
                    providerId: account.providerId,
                    issuer: account.issuer,
                    accountId: account.accountId,
                    createdAt: account.createdAt,
                    updatedAt: account.updatedAt
                  })
                  .from(account)
                  .where(eq(account.userId, userId))
              ),
              unavailable(
                db
                  .select({
                    id: passkey.id,
                    name: passkey.name,
                    credentialID: passkey.credentialID,
                    deviceType: passkey.deviceType,
                    backedUp: passkey.backedUp,
                    transports: passkey.transports,
                    createdAt: passkey.createdAt
                  })
                  .from(passkey)
                  .where(eq(passkey.userId, userId))
              )
            ],
            { concurrency: 'unbounded' }
          )
          const found = users[0]
          if (!found) {
            return yield* new CapabilityUnavailable({
              capability: 'personal-data-export',
              reason: 'user_not_found'
            })
          }
          // oxlint-disable-next-line effect/noGlobals -- archive timestamp is informational.
          const generatedAt = new Date().toISOString()
          return {
            generatedAt,
            user: {
              id: found.id,
              name: found.name,
              email: found.email,
              image: found.image,
              username: found.username,
              displayUsername: found.displayUsername,
              emailVerified: found.emailVerified,
              locale: found.locale,
              timeZone: found.timeZone,
              createdAt: found.createdAt.toISOString(),
              updatedAt: found.updatedAt.toISOString()
            },
            workspaces,
            accountPreferences: accountPrefs,
            notificationPreferences: notificationPrefs,
            notifications: noticeRows.map((row) => ({
              id: row.id,
              workspaceId: row.workspaceId,
              kind: row.kind,
              title: row.title,
              message: row.message,
              read: row.readAt !== null,
              createdAt: row.createdAt
            })),
            sessions: sessions.map((row) => ({
              id: row.id,
              expiresAt: row.expiresAt.toISOString(),
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
              ipAddress: row.ipAddress,
              userAgent: row.userAgent
            })),
            linkedAccounts: accounts.map((row) => ({
              id: row.id,
              providerId: row.providerId,
              issuer: row.issuer,
              accountId: row.accountId,
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString()
            })),
            passkeys: passkeys.map((row) => ({
              id: row.id,
              name: row.name,
              credentialID: row.credentialID,
              deviceType: row.deviceType,
              backedUp: row.backedUp,
              transports: row.transports,
              createdAt: row.createdAt.toISOString()
            }))
          }
        })
    }
  })
)
