import {
  notificationChannels,
  notificationKinds,
  securityNotificationKinds,
  type NotificationChannel as StoredNotificationChannel,
  type NotificationKind as StoredNotificationKind
} from '@b2b-saas-starter/db/enums'
import { Schema } from 'effect'

/**
 * The notification vocabulary, lifted from the stored enums in
 * `@b2b-saas-starter/db` into `Schema.Literals` so server-function inputs and
 * queue messages decode against the same list the column stores. The stored
 * tuples are the source; this module only lifts them.
 */
export const NOTIFICATION_KINDS = notificationKinds
export const NotificationKind = Schema.Literals(NOTIFICATION_KINDS)
export type NotificationKind = StoredNotificationKind

export const NOTIFICATION_CHANNELS = notificationChannels
export const NotificationChannel = Schema.Literals(NOTIFICATION_CHANNELS)
export type NotificationChannel = StoredNotificationChannel

const securityKinds: ReadonlySet<string> = new Set(securityNotificationKinds)

/** Whether a kind is one of the security kinds that default to `instant`. */
export function isSecurityNotificationKind(kind: NotificationKind): boolean {
  return securityKinds.has(kind)
}

/**
 * The channel a user who has never set a preference for `kind` receives it
 * on: `instant` for the security kinds, `digest` for everything else. This is
 * the whole default policy — the preferences table stores only what a user
 * changed, so a new kind gets its default from here without a backfill.
 */
export function defaultChannelFor(kind: NotificationKind): NotificationChannel {
  if (isSecurityNotificationKind(kind)) {
    return 'instant'
  }
  return 'digest'
}

/**
 * The channel that applies: the stored choice when there is one, the kind's
 * default otherwise. Pure, so both adapters and the tests share it.
 */
export function resolveChannel(
  kind: NotificationKind,
  stored: NotificationChannel | undefined
): NotificationChannel {
  return stored ?? defaultChannelFor(kind)
}

export type NotificationKindDescription = {
  readonly label: string
  readonly description: string
}

/**
 * Human copy per kind, shared by the preferences UI and the email subjects so
 * the same words describe a kind everywhere the user meets it.
 */
export const NOTIFICATION_KIND_DESCRIPTIONS = {
  'api_token.created': {
    label: 'API token created',
    description: 'A new API token was minted in one of your workspaces.'
  },
  'api_token.revoked': {
    label: 'API token revoked',
    description: 'An API token in one of your workspaces was revoked.'
  },
  'workspace_member.role_changed': {
    label: 'Your workspace role changed',
    description: 'An owner or admin changed what you can do in a workspace.'
  },
  'two_factor.changed': {
    label: 'Two-factor authentication changed',
    description: 'Two-factor authentication was turned on or off for your account.'
  },
  'webhook.delivery_failed': {
    label: 'Webhook delivery failed',
    description: 'A webhook endpoint gave up after retries or rejected a delivery.'
  },
  'workspace_member.joined': {
    label: 'Member joined',
    description: 'Somebody accepted an invitation to one of your workspaces.'
  },
  'billing.plan_changed': {
    label: 'Plan changed',
    description: 'A workspace moved to a different plan.'
  },
  'account.impersonated': {
    label: 'Account impersonated',
    description: 'A System Admin signed in to your account for support.'
  },
  announcement: {
    label: 'Announcements',
    description: 'Workspace-wide notices from the starter or your workspace owners.'
  }
} satisfies Readonly<Record<NotificationKind, NotificationKindDescription>>

export function describeNotificationKind(
  kind: NotificationKind
): NotificationKindDescription {
  return NOTIFICATION_KIND_DESCRIPTIONS[kind]
}
