import { type NotificationEmailContext } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { type NotificationKind } from '@b2b-saas-starter/capabilities/notifications/notification-kinds'

/** Where a notification email sends the reader when no base URL is configured. */
export const DEFAULT_APP_URL = 'http://localhost:3071'

/**
 * The app's public origin for links in outbound email. The web worker's
 * `BETTER_AUTH_URL` is that origin already, so alchemy forwards the same value
 * here rather than minting a second name for it; local dev falls back to the
 * dev server.
 */
export function appUrlFrom(env: {
  readonly BETTER_AUTH_URL?: string | null | undefined
}): string {
  const value = env.BETTER_AUTH_URL
  if (value === undefined || value === null || value.length === 0) {
    return DEFAULT_APP_URL
  }
  return value.replace(/\/+$/, '')
}

/** The signed-in preferences page, with the kind preselected when given. */
export function preferencesUrl(appUrl: string, kind?: NotificationKind): string {
  if (kind === undefined) {
    return `${appUrl}/account/notifications`
  }
  return `${appUrl}/account/notifications?kind=${encodeURIComponent(kind)}`
}

/**
 * The workspace page that owns each kind, relative to the workspace root.
 * `null` sends the reader to the account page instead of a workspace.
 */
const WORKSPACE_PATH_BY_KIND = {
  'api_token.created': '/api-tokens',
  'api_token.revoked': '/api-tokens',
  'workspace_member.role_changed': '/members',
  'workspace_member.joined': '/members',
  'webhook.delivery_failed': '/webhooks',
  'billing.plan_changed': '/billing',
  'two_factor.changed': null,
  announcement: ''
} satisfies Readonly<Record<NotificationKind, string | null>>

/**
 * The page a Notification is about: the workspace surface that owns the kind,
 * or the account page for an account-level one.
 */
export function openUrlFor(appUrl: string, context: NotificationEmailContext): string {
  const slug = context.workspace?.slug
  const path = WORKSPACE_PATH_BY_KIND[context.notification.kind]
  if (slug === undefined || path === null) {
    return `${appUrl}/account`
  }
  return `${appUrl}/workspaces/${encodeURIComponent(slug)}${path}`
}
