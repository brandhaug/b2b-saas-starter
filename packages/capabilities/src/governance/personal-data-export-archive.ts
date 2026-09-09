import { Schema } from 'effect'
import { EmailDeliveryRecord } from '@b2b-saas-starter/email-delivery/email-delivery'
import { WorkspaceWithMembership } from './workspace-membership.ts'
import { AccountPreferences } from './account-preferences.ts'
import { NotificationPreference } from '../notifications/notification-preferences.ts'
import { Notification } from '../notifications/notification-feed.ts'

const MaybeString = Schema.NullOr(Schema.String)
export const PersonalDataExport = Schema.Struct({
  generatedAt: Schema.String,
  user: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
    image: MaybeString,
    username: MaybeString,
    displayUsername: MaybeString,
    emailVerified: Schema.Boolean,
    locale: MaybeString,
    timeZone: MaybeString,
    createdAt: Schema.String,
    updatedAt: Schema.String
  }),
  workspaces: Schema.Array(WorkspaceWithMembership),
  accountPreferences: AccountPreferences,
  notificationPreferences: Schema.Array(NotificationPreference),
  emailDeliveries: Schema.Array(EmailDeliveryRecord),
  notifications: Schema.Array(
    Schema.Struct({
      id: Notification.fields.id,
      kind: Notification.fields.kind,
      title: Notification.fields.title,
      message: Notification.fields.message,
      read: Notification.fields.read,
      createdAt: Notification.fields.createdAt,
      workspaceId: Schema.NullOr(Schema.String)
    })
  ),
  sessions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      expiresAt: Schema.String,
      createdAt: Schema.String,
      updatedAt: Schema.String,
      ipAddress: MaybeString,
      userAgent: MaybeString
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
  oauthClients: Schema.Array(
    Schema.Struct({
      clientId: Schema.String,
      name: MaybeString,
      uri: MaybeString,
      icon: MaybeString,
      disabled: Schema.NullOr(Schema.Boolean),
      scopes: Schema.NullOr(Schema.Array(Schema.String)),
      createdAt: Schema.String,
      updatedAt: Schema.String
    })
  ),
  oauthConsents: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      clientId: Schema.String,
      referenceId: MaybeString,
      scopes: Schema.Array(Schema.String),
      createdAt: Schema.String,
      updatedAt: Schema.String
    })
  ),
  passkeys: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: MaybeString,
      credentialID: Schema.String,
      deviceType: Schema.String,
      backedUp: Schema.Boolean,
      transports: MaybeString,
      createdAt: Schema.String
    })
  )
})
export type PersonalDataExport = typeof PersonalDataExport.Type
export function renderPersonalDataExport(data: PersonalDataExport): string {
  // oxlint-disable-next-line effect/noGlobals -- JSON is the documented downloadable archive format.
  return `${JSON.stringify({ schemaVersion: 1, readme: 'Personal account data export. Secrets, credentials, authentication tokens, and other users data are excluded.', ...data }, null, 2)}\n`
}
