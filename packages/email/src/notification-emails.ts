import { type NotificationKind } from '@b2b-saas-starter/db/enums'
import { DEFAULT_LOCALE } from '@b2b-saas-starter/i18n/locale'
import * as m from '@b2b-saas-starter/i18n/messages'
import { type ReactElement } from 'react'
import {
  NotificationBody,
  type NotificationCopy,
  type NotificationEmailProps
} from './notification-templates.tsx'

export type {
  DigestItem,
  NotificationDigestEmailProps,
  NotificationEmailProps
} from './notification-templates.tsx'
export { NotificationDigestEmail } from './notification-templates.tsx'

/**
 * The copy that separates one kind of notification email from another: every
 * kind renders the same body, and only these two sentences differ. Consumers
 * pick by the Notification's stored `kind`; `satisfies` pins the record to
 * the stored enum, so adding a kind is a type error here until it has copy.
 * Never loosen it to an index signature — that is what turns a missing kind
 * into a silent fallback to the announcement wording.
 */
export const NOTIFICATION_EMAIL_COPY = {
  'api_token.created': (locale) => ({
    lead: m.backend_email_notification_api_token_created_lead({}, { locale }),
    action: m.backend_email_notification_api_token_created_action({}, { locale })
  }),
  'api_token.revoked': (locale) => ({
    lead: m.backend_email_notification_api_token_revoked_lead({}, { locale }),
    action: m.backend_email_notification_api_token_revoked_action({}, { locale })
  }),
  'workspace_member.role_changed': (locale) => ({
    lead: m.backend_email_notification_role_changed_lead({}, { locale }),
    action: m.backend_email_notification_role_changed_action({}, { locale })
  }),
  'two_factor.changed': (locale) => ({
    lead: m.backend_email_notification_two_factor_changed_lead({}, { locale }),
    action: m.backend_email_notification_two_factor_changed_action({}, { locale })
  }),
  'webhook.delivery_failed': (locale) => ({
    lead: m.backend_email_notification_webhook_failed_lead({}, { locale }),
    action: m.backend_email_notification_webhook_failed_action({}, { locale })
  }),
  'workspace_member.joined': (locale) => ({
    lead: m.backend_email_notification_member_joined_lead({}, { locale }),
    action: m.backend_email_notification_member_joined_action({}, { locale })
  }),
  'billing.plan_changed': (locale) => ({
    lead: m.backend_email_notification_plan_changed_lead({}, { locale }),
    action: m.backend_email_notification_plan_changed_action({}, { locale })
  }),
  'account.impersonated': (locale) => ({
    lead: m.backend_email_notification_impersonated_lead({}, { locale }),
    action: m.backend_email_notification_impersonated_action({}, { locale })
  }),
  announcement: (locale) => ({
    lead: m.backend_email_notification_announcement_lead({}, { locale }),
    action: m.backend_email_notification_announcement_action({}, { locale })
  })
} satisfies Record<NotificationKind, NotificationCopy>

const previewBase = {
  kindLabel: 'API token created',
  title: 'API token created',
  message: 'Ops Lead created "MCP local client" with read and write scopes.',
  workspaceName: 'Starter Lab',
  openUrl: 'http://localhost:3071/workspaces/starter-lab/api-tokens',
  preferencesUrl: 'http://localhost:3071/account/notifications?kind=api_token.created'
} satisfies NotificationEmailProps

/**
 * One fixture per stored kind: react-email's preview server, the tests, and
 * the AGENTS-documented "every template has preview props" rule all read
 * this. `satisfies` pins it to `NotificationKind`, so a new kind in the
 * database enum is a type error here until it has copy to render.
 */
export const NOTIFICATION_PREVIEW_PROPS = {
  'api_token.created': previewBase,
  'api_token.revoked': {
    ...previewBase,
    kindLabel: 'API token revoked',
    title: 'API token revoked',
    message:
      'Ops Lead revoked "MCP local client". Integrations using this token will stop working.',
    preferencesUrl: 'http://localhost:3071/account/notifications?kind=api_token.revoked'
  },
  'workspace_member.role_changed': {
    ...previewBase,
    kindLabel: 'Workspace role changed',
    title: 'Workspace role changed',
    message: 'Jordan Lee changed your role from member to administrator.',
    openUrl: 'http://localhost:3071/workspaces/starter-lab/members',
    preferencesUrl:
      'http://localhost:3071/account/notifications?kind=workspace_member.role_changed'
  },
  'two_factor.changed': {
    ...previewBase,
    kindLabel: 'Two-factor authentication changed',
    title: 'Two-factor authentication changed',
    message:
      'Two-factor authentication was enabled for your account. If that was not you, reset your password now.',
    workspaceName: null,
    openUrl: 'http://localhost:3071/account',
    preferencesUrl:
      'http://localhost:3071/account/notifications?kind=two_factor.changed'
  },
  'webhook.delivery_failed': {
    ...previewBase,
    kindLabel: 'Webhook delivery failed',
    title: 'Webhook delivery failed',
    message:
      'https://example.com/webhooks/starter rejected billing.plan_changed and will not be retried.',
    openUrl: 'http://localhost:3071/workspaces/starter-lab/webhooks',
    preferencesUrl:
      'http://localhost:3071/account/notifications?kind=webhook.delivery_failed'
  },
  'workspace_member.joined': {
    ...previewBase,
    kindLabel: 'Member joined',
    title: 'Invitation accepted',
    message: 'Taylor Morgan joined Starter Lab as a member.',
    openUrl: 'http://localhost:3071/workspaces/starter-lab/members',
    preferencesUrl:
      'http://localhost:3071/account/notifications?kind=workspace_member.joined'
  },
  'billing.plan_changed': {
    ...previewBase,
    kindLabel: 'Plan changed',
    title: 'Plan changed to Team',
    message: 'The workspace now serves the Team plan limits.',
    openUrl: 'http://localhost:3071/workspaces/starter-lab/billing',
    preferencesUrl:
      'http://localhost:3071/account/notifications?kind=billing.plan_changed'
  },
  'account.impersonated': {
    ...previewBase,
    kindLabel: 'Account impersonated',
    title: 'A System Admin accessed your account',
    message:
      'Martin Brandhaug started an impersonation session on your account. It ends when they stop it or after 60 minutes.',
    workspaceName: null,
    openUrl: 'http://localhost:3071/account',
    preferencesUrl:
      'http://localhost:3071/account/notifications?kind=account.impersonated'
  },
  announcement: {
    ...previewBase,
    kindLabel: 'Announcements',
    title: 'Workspace export ready',
    message: 'Your export of Starter Lab is ready to download from workspace settings.',
    openUrl: 'http://localhost:3071/workspaces/starter-lab',
    preferencesUrl: 'http://localhost:3071/account/notifications?kind=announcement'
  }
} satisfies Record<NotificationKind, NotificationEmailProps>

export function notificationEmailFor(
  kind: NotificationKind,
  props: NotificationEmailProps
): ReactElement {
  const copy = NOTIFICATION_EMAIL_COPY[kind](props.locale ?? DEFAULT_LOCALE)
  return NotificationBody({ ...props, lead: copy.lead, action: copy.action })
}
