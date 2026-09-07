import {
  notificationChannels,
  notificationKinds,
  securityNotificationKinds,
  type NotificationChannel as StoredNotificationChannel,
  type NotificationKind as StoredNotificationKind
} from '@b2b-saas-starter/db/enums'
import { Schema } from 'effect'
import * as m from '@b2b-saas-starter/i18n/messages'
import { DEFAULT_LOCALE, type Locale } from '@b2b-saas-starter/i18n/locale'

/**
 * The notification vocabulary, lifted from the stored enums in
 * `@b2b-saas-starter/db` into `Schema.Literals` so server-function inputs and
 * queue messages decode against the same list the column stores. The stored
 * tuples are the source; this module only lifts them.
 */
export const NOTIFICATION_KINDS = notificationKinds
export const NotificationKind = Schema.Literals(NOTIFICATION_KINDS)
export type NotificationKind = StoredNotificationKind

const NOTIFICATION_CHANNELS = notificationChannels
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

/** Human copy per kind, resolved in the account's current locale. */
export function notificationKindLabel(
  kind: NotificationKind,
  locale: Locale = DEFAULT_LOCALE
): string {
  const options = { locale }
  switch (kind) {
    case 'api_token.created': {
      return m.backend_email_notification_kind_api_token_created({}, options)
    }
    case 'api_token.revoked': {
      return m.backend_email_notification_kind_api_token_revoked({}, options)
    }
    case 'workspace_member.role_changed': {
      return m.backend_email_notification_kind_role_changed({}, options)
    }
    case 'two_factor.changed': {
      return m.backend_email_notification_kind_two_factor_changed({}, options)
    }
    case 'webhook.delivery_failed': {
      return m.backend_email_notification_kind_webhook_failed({}, options)
    }
    case 'workspace_member.joined': {
      return m.backend_email_notification_kind_member_joined({}, options)
    }
    case 'billing.plan_changed': {
      return m.backend_email_notification_kind_plan_changed({}, options)
    }
    case 'account.impersonated': {
      return m.backend_email_notification_kind_impersonated({}, options)
    }
    case 'announcement': {
      return m.backend_email_notification_kind_announcement({}, options)
    }
  }
}

export function notificationKindDescription(
  kind: NotificationKind,
  locale: Locale = DEFAULT_LOCALE
): string {
  const options = { locale }
  switch (kind) {
    case 'api_token.created': {
      return m.backend_email_notification_api_token_created_lead({}, options)
    }
    case 'api_token.revoked': {
      return m.backend_email_notification_api_token_revoked_lead({}, options)
    }
    case 'workspace_member.role_changed': {
      return m.backend_email_notification_role_changed_lead({}, options)
    }
    case 'two_factor.changed': {
      return m.backend_email_notification_two_factor_changed_lead({}, options)
    }
    case 'webhook.delivery_failed': {
      return m.backend_email_notification_webhook_failed_lead({}, options)
    }
    case 'workspace_member.joined': {
      return m.backend_email_notification_member_joined_lead({}, options)
    }
    case 'billing.plan_changed': {
      return m.backend_email_notification_plan_changed_lead({}, options)
    }
    case 'account.impersonated': {
      return m.backend_email_notification_impersonated_lead({}, options)
    }
    case 'announcement': {
      return m.backend_email_notification_announcement_lead({}, options)
    }
  }
}
