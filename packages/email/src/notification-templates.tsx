import { Link, Section, Text } from '@react-email/components'
import { type ReactNode } from 'react'
import { ActionLink, EmailLayout } from './templates.tsx'

/**
 * What every notification email is rendered from. The Notification's own
 * `title` and `message` are the body; the kind picks the template, which adds
 * the preview line, heading, and the sentence that says why this email exists.
 * `kindLabel` is the kind's shared copy (`NOTIFICATION_KIND_DESCRIPTIONS`), so
 * the subject, the email heading, and the preview line all use the same words
 * the preferences UI uses. `preferencesUrl` is the unsubscribe link: it lands
 * on the signed-in `/account/notifications` page with the kind preselected,
 * so one click turns that kind off without touching the rest.
 */
export type NotificationEmailProps = {
  readonly kindLabel: string
  readonly title: string
  readonly message: string
  /** Null for a Notification with no workspace (account-level). */
  readonly workspaceName: string | null
  /** Absolute link into the app: the workspace dashboard, or the account page. */
  readonly openUrl: string
  readonly preferencesUrl: string
}

type NotificationBodyProps = NotificationEmailProps & {
  /** One sentence naming the event class, before the Notification's own copy. */
  readonly lead: ReactNode
  readonly action: string
}

/**
 * The shared footer of every notification email: why it arrived and how to
 * stop it. The link is the unsubscribe path required of every notification
 * email — it points at the preferences page, never at a one-click endpoint,
 * so no unauthenticated URL can change a preference.
 */
function NotificationFooter({ preferencesUrl }: { readonly preferencesUrl: string }) {
  return (
    <Text className="text-xs text-gray-500 mt-8">
      You receive this email because of your notification preferences.{' '}
      <Link href={preferencesUrl} className="text-brand underline">
        Change how you get these emails or unsubscribe
      </Link>
      .
    </Text>
  )
}

function WorkspaceLine({ workspaceName }: { readonly workspaceName: string | null }) {
  if (workspaceName === null) {
    return null
  }
  return (
    <Text className="text-sm text-gray-500 mt-2 mb-0">Workspace: {workspaceName}</Text>
  )
}

function NotificationBody({
  kindLabel,
  lead,
  action,
  title,
  message,
  workspaceName,
  openUrl,
  preferencesUrl
}: NotificationBodyProps) {
  return (
    <EmailLayout preview={kindLabel} heading={kindLabel}>
      <Text className="text-base text-gray-700 mt-4">{lead}</Text>
      <Section className="bg-gray-50 rounded-md px-4 py-3 mt-4">
        <Text className="text-base font-medium text-gray-900 m-0">{title}</Text>
        <Text className="text-sm text-gray-700 mt-1 mb-0">{message}</Text>
        <WorkspaceLine workspaceName={workspaceName} />
      </Section>
      <ActionLink href={openUrl} label={action} />
      <NotificationFooter preferencesUrl={preferencesUrl} />
    </EmailLayout>
  )
}

export function ApiTokenCreatedEmail(props: NotificationEmailProps) {
  return (
    <NotificationBody
      {...props}
      lead="Somebody minted a new API token in a workspace you belong to. If nobody on your team did this, revoke it now."
      action="Review API tokens"
    />
  )
}

export function ApiTokenRevokedEmail(props: NotificationEmailProps) {
  return (
    <NotificationBody
      {...props}
      lead="An API token in a workspace you belong to no longer works. Integrations that used it will start failing."
      action="Review API tokens"
    />
  )
}

export function MemberRoleChangedEmail(props: NotificationEmailProps) {
  return (
    <NotificationBody
      {...props}
      lead="An owner or admin changed what you can do in this workspace."
      action="Open the workspace"
    />
  )
}

export function TwoFactorChangedNotificationEmail(props: NotificationEmailProps) {
  return (
    <NotificationBody
      {...props}
      lead="Two-factor authentication was turned on or off for your account. If that was not you, reset your password now."
      action="Review account security"
    />
  )
}

export function WebhookDeliveryFailedEmail(props: NotificationEmailProps) {
  return (
    <NotificationBody
      {...props}
      lead="A webhook endpoint rejected a delivery or gave up after retries. The delivery history has the response codes."
      action="Open webhook endpoints"
    />
  )
}

export function MemberJoinedEmail(props: NotificationEmailProps) {
  return (
    <NotificationBody
      {...props}
      lead="Somebody accepted an invitation to a workspace you belong to."
      action="See members"
    />
  )
}

export function PlanChangedEmail(props: NotificationEmailProps) {
  return (
    <NotificationBody
      {...props}
      lead="A workspace you belong to is on a different plan. Limits and entitlements follow the new plan from now on."
      action="Open billing"
    />
  )
}

export function AccountImpersonatedEmail(props: NotificationEmailProps) {
  return (
    <NotificationBody
      {...props}
      lead="A System Admin opened an impersonation session on your account for support. It is recorded in the audit trail and cannot change your password, two-factor settings, or email."
      action="Review account security"
    />
  )
}

export function AnnouncementEmail(props: NotificationEmailProps) {
  return (
    <NotificationBody
      {...props}
      lead="A notice for everyone in the workspace."
      action="Open the workspace"
    />
  )
}

const previewNotification = {
  kindLabel: 'API token created',
  title: 'API token created',
  message: 'Ops Lead minted "MCP local client" with read and write scopes.',
  workspaceName: 'Starter Lab',
  openUrl: 'http://localhost:3071/workspaces/starter-lab/api-tokens',
  preferencesUrl: 'http://localhost:3071/account/notifications?kind=api_token.created'
} satisfies NotificationEmailProps

ApiTokenCreatedEmail.PreviewProps = previewNotification
ApiTokenRevokedEmail.PreviewProps = previewNotification
MemberRoleChangedEmail.PreviewProps = previewNotification
TwoFactorChangedNotificationEmail.PreviewProps = previewNotification
WebhookDeliveryFailedEmail.PreviewProps = previewNotification
MemberJoinedEmail.PreviewProps = previewNotification
PlanChangedEmail.PreviewProps = previewNotification
AccountImpersonatedEmail.PreviewProps = {
  ...previewNotification,
  kindLabel: 'Account impersonated',
  title: 'A System Admin accessed your account',
  message:
    'Martin Brandhaug started an impersonation session on your account. It ends when they stop it or after 60 minutes.',
  workspaceName: null,
  openUrl: 'http://localhost:3071/account',
  preferencesUrl:
    'http://localhost:3071/account/notifications?kind=account.impersonated'
}
AnnouncementEmail.PreviewProps = previewNotification

/** One line of the digest: what happened, where, and the app link for it. */
export type DigestItem = {
  /** The Notification's id; unique within one digest, so it keys the row. */
  readonly id: string
  readonly kindLabel: string
  readonly title: string
  readonly message: string
  readonly workspaceName: string | null
  /**
   * Display-ready timestamp (e.g. `2026-05-16 07:30 UTC`), formatted by the
   * sender from the time it already holds — the template reads no clock.
   */
  readonly createdAt: string
}

export type NotificationDigestEmailProps = {
  readonly recipientName: string
  readonly items: ReadonlyArray<DigestItem>
  readonly openUrl: string
  readonly preferencesUrl: string
}

function digestRowHeading(item: DigestItem): string {
  if (item.workspaceName === null) {
    return item.kindLabel
  }
  return `${item.kindLabel} · ${item.workspaceName}`
}

function DigestRow({ item }: { readonly item: DigestItem }) {
  return (
    <Section className="border-solid border-0 border-b border-gray-200 py-3">
      <Text className="text-xs uppercase tracking-wide text-gray-500 m-0">
        {digestRowHeading(item)}
      </Text>
      <Text className="text-base font-medium text-gray-900 mt-1 mb-0">
        {item.title}
      </Text>
      <Text className="text-sm text-gray-700 mt-1 mb-0">{item.message}</Text>
      <Text className="text-xs text-gray-400 mt-1 mb-0">{item.createdAt}</Text>
    </Section>
  )
}

/**
 * The daily digest: every unread Notification of the last 24 hours whose kind
 * the recipient takes as `digest`, in one email. Sent at 08:00 UTC by the
 * background worker's cron trigger (ADR 0061).
 */
export function NotificationDigestEmail({
  recipientName,
  items,
  openUrl,
  preferencesUrl
}: NotificationDigestEmailProps) {
  let countLine = `${items.length} unread notifications from the last 24 hours.`
  if (items.length === 1) {
    countLine = 'One unread notification from the last 24 hours.'
  }
  return (
    <EmailLayout
      preview={`Your daily digest: ${countLine}`}
      heading="Your daily notification digest"
    >
      <Text className="text-base text-gray-700 mt-4">
        Hi {recipientName}, {countLine}
      </Text>
      <Section className="mt-4">
        {items.map((item) => (
          <DigestRow key={item.id} item={item} />
        ))}
      </Section>
      <ActionLink href={openUrl} label="Open your workspaces" />
      <NotificationFooter preferencesUrl={preferencesUrl} />
    </EmailLayout>
  )
}

NotificationDigestEmail.PreviewProps = {
  recipientName: 'Demo Admin',
  items: [
    {
      id: 'not_preview_1',
      kindLabel: 'Webhook delivery failed',
      title: 'Webhook delivery gave up',
      message:
        'https://example.com/webhooks/starter rejected api_token.created after six attempts.',
      workspaceName: 'Starter Lab',
      createdAt: '2026-05-16 07:30 UTC'
    },
    {
      id: 'not_preview_2',
      kindLabel: 'Announcements',
      title: 'Cloudflare Email needs configuration',
      message: 'Set CLOUDFLARE_EMAIL_FROM before enabling real email delivery.',
      workspaceName: 'Starter Lab',
      createdAt: '2026-05-16 08:10 UTC'
    }
  ],
  openUrl: 'http://localhost:3071/workspaces',
  preferencesUrl: 'http://localhost:3071/account/notifications'
} satisfies NotificationDigestEmailProps
