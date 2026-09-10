import { type NotificationKind } from '@b2b-saas-starter/db/enums'
import { type ReactElement } from 'react'
import {
  NotificationEmail,
  type NotificationEmailProps
} from './notification-templates.tsx'

export type {
  DigestItem,
  NotificationDigestEmailProps,
  NotificationEmailProps
} from './notification-templates.tsx'
export { NotificationDigestEmail } from './notification-templates.tsx'

/**
 * The element a consumer sends for a Notification. One template covers every
 * kind; `NOTIFICATION_COPY` in the template file is the `satisfies`-pinned
 * per-kind copy, so a new stored kind is a type error until it has copy.
 */
export function notificationEmailFor(
  kind: NotificationKind,
  props: NotificationEmailProps
): ReactElement {
  return NotificationEmail({ kind, ...props })
}

const previewBase = {
  kindLabel: 'API token created',
  title: 'API token created',
  message: 'Ops Lead created "MCP local client" with read and write scopes.',
  workspaceName: 'Starter Lab',
  openUrl: 'http://localhost:3071/workspaces/starter-lab/api-tokens',
  preferencesUrl: 'http://localhost:3071/account/notifications?kind=api_token.created'
} satisfies NotificationEmailProps

/**
 * Representative props per kind: the react-email preview server's entries
 * (`src/previews`) and the template tests both render from these.
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
} satisfies Readonly<Record<NotificationKind, NotificationEmailProps>>
