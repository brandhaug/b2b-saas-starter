import { type NotificationKind } from '@b2b-saas-starter/db/enums'
import { type ReactElement } from 'react'
import {
  AccountImpersonatedEmail,
  AnnouncementEmail,
  ApiTokenCreatedEmail,
  ApiTokenRevokedEmail,
  MemberJoinedEmail,
  MemberRoleChangedEmail,
  PlanChangedEmail,
  TwoFactorChangedNotificationEmail,
  WebhookDeliveryFailedEmail,
  type NotificationEmailProps
} from './notification-templates.tsx'

export type {
  DigestItem,
  NotificationDigestEmailProps,
  NotificationEmailProps
} from './notification-templates.tsx'
export { NotificationDigestEmail } from './notification-templates.tsx'

/**
 * One template per kind. The consumer picks by the Notification's stored
 * `kind`; a kind without an entry here is a type error, so adding a kind to
 * the stored enum forces a template. Lives beside the templates rather than
 * in their file so that file exports components only.
 */
export const NOTIFICATION_EMAIL_TEMPLATES = {
  'api_token.created': ApiTokenCreatedEmail,
  'api_token.revoked': ApiTokenRevokedEmail,
  'workspace_member.role_changed': MemberRoleChangedEmail,
  'two_factor.changed': TwoFactorChangedNotificationEmail,
  'webhook.delivery_failed': WebhookDeliveryFailedEmail,
  'workspace_member.joined': MemberJoinedEmail,
  'billing.plan_changed': PlanChangedEmail,
  'account.impersonated': AccountImpersonatedEmail,
  announcement: AnnouncementEmail
} satisfies Readonly<
  Record<NotificationKind, (props: NotificationEmailProps) => ReactElement>
>

export function notificationEmailFor(
  kind: NotificationKind,
  props: NotificationEmailProps
): ReactElement {
  return NOTIFICATION_EMAIL_TEMPLATES[kind](props)
}
