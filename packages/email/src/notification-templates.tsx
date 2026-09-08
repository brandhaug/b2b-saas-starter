import { Link, Section, Text } from 'react-email'
import { type ReactNode } from 'react'
import * as m from '@b2b-saas-starter/i18n/messages'
import { DEFAULT_LOCALE, type Locale } from '@b2b-saas-starter/i18n/locale'
import { ActionLink, EmailLayout } from './templates.tsx'

/**
 * What every notification email is rendered from. The Notification's own
 * `title` and `message` are the body; the kind picks the template, which adds
 * the preview line, heading, and the sentence that says why this email exists.
 * `kindLabel` is the kind's shared localized copy, so the subject, the email
 * heading, and the preview line all use the same words the preferences UI uses.
 * `preferencesUrl` is the unsubscribe link: it lands
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
  readonly locale?: Locale | undefined
}

type NotificationBodyProps = NotificationEmailProps & {
  /** One sentence naming the event class, before the Notification's own copy. */
  readonly lead: ReactNode
  readonly action: string
}

type NotificationCopy = { readonly lead: string; readonly action: string }

function notificationCopy(kind: string, locale: Locale): NotificationCopy {
  const options = { locale }
  switch (kind) {
    case 'api_token.created': {
      return {
        lead: m.backend_email_notification_api_token_created_lead({}, options),
        action: m.backend_email_notification_api_token_created_action({}, options)
      }
    }
    case 'api_token.revoked': {
      return {
        lead: m.backend_email_notification_api_token_revoked_lead({}, options),
        action: m.backend_email_notification_api_token_revoked_action({}, options)
      }
    }
    case 'workspace_member.role_changed': {
      return {
        lead: m.backend_email_notification_role_changed_lead({}, options),
        action: m.backend_email_notification_role_changed_action({}, options)
      }
    }
    case 'two_factor.changed': {
      return {
        lead: m.backend_email_notification_two_factor_changed_lead({}, options),
        action: m.backend_email_notification_two_factor_changed_action({}, options)
      }
    }
    case 'webhook.delivery_failed': {
      return {
        lead: m.backend_email_notification_webhook_failed_lead({}, options),
        action: m.backend_email_notification_webhook_failed_action({}, options)
      }
    }
    case 'workspace_member.joined': {
      return {
        lead: m.backend_email_notification_member_joined_lead({}, options),
        action: m.backend_email_notification_member_joined_action({}, options)
      }
    }
    case 'billing.plan_changed': {
      return {
        lead: m.backend_email_notification_plan_changed_lead({}, options),
        action: m.backend_email_notification_plan_changed_action({}, options)
      }
    }
    case 'account.impersonated': {
      return {
        lead: m.backend_email_notification_impersonated_lead({}, options),
        action: m.backend_email_notification_impersonated_action({}, options)
      }
    }
    default: {
      return {
        lead: m.backend_email_notification_announcement_lead({}, options),
        action: m.backend_email_notification_announcement_action({}, options)
      }
    }
  }
}

/**
 * The shared footer of every notification email: why it arrived and how to
 * stop it. The link is the unsubscribe path required of every notification
 * email — it points at the preferences page, never at a one-click endpoint,
 * so no unauthenticated URL can change a preference.
 */
function NotificationFooter({
  preferencesUrl,
  locale = DEFAULT_LOCALE
}: {
  readonly preferencesUrl: string
  readonly locale?: Locale | undefined
}) {
  return (
    <Text className="text-sm text-muted-foreground mt-8">
      {m.backend_email_notification_footer({}, { locale })}{' '}
      <Link href={preferencesUrl} className="text-primary underline">
        {m.backend_email_notification_footer_link({}, { locale })}
      </Link>
      .
    </Text>
  )
}

function WorkspaceLine({
  workspaceName,
  locale
}: {
  readonly workspaceName: string | null
  readonly locale: Locale
}) {
  if (workspaceName === null) {
    return null
  }
  return (
    <Text className="text-sm text-muted-foreground mt-2 mb-0">
      {m.backend_email_notification_workspace({ workspaceName }, { locale })}
    </Text>
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
  preferencesUrl,
  locale: requestedLocale
}: NotificationBodyProps) {
  const locale = requestedLocale ?? DEFAULT_LOCALE
  return (
    <EmailLayout preview={title} heading={kindLabel} locale={locale}>
      <Text className="text-base text-foreground mt-4">{lead}</Text>
      <Section className="bg-muted px-4 py-3 mt-4">
        <Text className="text-base font-medium text-foreground m-0">{title}</Text>
        <Text className="text-sm text-foreground mt-1 mb-0">{message}</Text>
        <WorkspaceLine workspaceName={workspaceName} locale={locale} />
      </Section>
      <ActionLink href={openUrl} label={action} locale={locale} />
      <NotificationFooter preferencesUrl={preferencesUrl} locale={locale} />
    </EmailLayout>
  )
}

function propsLocale(locale: Locale | undefined): Locale {
  return locale ?? DEFAULT_LOCALE
}

export function ApiTokenCreatedEmail(props: NotificationEmailProps) {
  const copy = notificationCopy('api_token.created', propsLocale(props.locale))
  return <NotificationBody {...props} lead={copy.lead} action={copy.action} />
}

export function ApiTokenRevokedEmail(props: NotificationEmailProps) {
  const copy = notificationCopy('api_token.revoked', propsLocale(props.locale))
  return <NotificationBody {...props} lead={copy.lead} action={copy.action} />
}

export function MemberRoleChangedEmail(props: NotificationEmailProps) {
  const copy = notificationCopy(
    'workspace_member.role_changed',
    propsLocale(props.locale)
  )
  return <NotificationBody {...props} lead={copy.lead} action={copy.action} />
}

export function TwoFactorChangedNotificationEmail(props: NotificationEmailProps) {
  const copy = notificationCopy('two_factor.changed', propsLocale(props.locale))
  return <NotificationBody {...props} lead={copy.lead} action={copy.action} />
}

export function WebhookDeliveryFailedEmail(props: NotificationEmailProps) {
  const copy = notificationCopy('webhook.delivery_failed', propsLocale(props.locale))
  return <NotificationBody {...props} lead={copy.lead} action={copy.action} />
}

export function MemberJoinedEmail(props: NotificationEmailProps) {
  const copy = notificationCopy('workspace_member.joined', propsLocale(props.locale))
  return <NotificationBody {...props} lead={copy.lead} action={copy.action} />
}

export function PlanChangedEmail(props: NotificationEmailProps) {
  const copy = notificationCopy('billing.plan_changed', propsLocale(props.locale))
  return <NotificationBody {...props} lead={copy.lead} action={copy.action} />
}

export function AccountImpersonatedEmail(props: NotificationEmailProps) {
  const copy = notificationCopy('account.impersonated', propsLocale(props.locale))
  return <NotificationBody {...props} lead={copy.lead} action={copy.action} />
}

export function AnnouncementEmail(props: NotificationEmailProps) {
  const copy = notificationCopy('announcement', propsLocale(props.locale))
  return <NotificationBody {...props} lead={copy.lead} action={copy.action} />
}

const previewBase = {
  kindLabel: 'API token created',
  title: 'API token created',
  message: 'Ops Lead created "MCP local client" with read and write scopes.',
  workspaceName: 'Starter Lab',
  openUrl: 'http://localhost:3071/workspaces/starter-lab/api-tokens',
  preferencesUrl: 'http://localhost:3071/account/notifications?kind=api_token.created'
} satisfies NotificationEmailProps

ApiTokenCreatedEmail.PreviewProps = previewBase
ApiTokenRevokedEmail.PreviewProps = {
  ...previewBase,
  kindLabel: 'API token revoked',
  title: 'API token revoked',
  message:
    'Ops Lead revoked "MCP local client". Integrations using this token will stop working.',
  preferencesUrl: 'http://localhost:3071/account/notifications?kind=api_token.revoked'
}
MemberRoleChangedEmail.PreviewProps = {
  ...previewBase,
  kindLabel: 'Workspace role changed',
  title: 'Workspace role changed',
  message: 'Jordan Lee changed your role from member to administrator.',
  openUrl: 'http://localhost:3071/workspaces/starter-lab/members',
  preferencesUrl:
    'http://localhost:3071/account/notifications?kind=workspace_member.role_changed'
}
TwoFactorChangedNotificationEmail.PreviewProps = {
  ...previewBase,
  kindLabel: 'Two-factor authentication changed',
  title: 'Two-factor authentication changed',
  message:
    'Two-factor authentication was enabled for your account. If that was not you, reset your password now.',
  workspaceName: null,
  openUrl: 'http://localhost:3071/account',
  preferencesUrl: 'http://localhost:3071/account/notifications?kind=two_factor.changed'
}
WebhookDeliveryFailedEmail.PreviewProps = {
  ...previewBase,
  kindLabel: 'Webhook delivery failed',
  title: 'Webhook delivery failed',
  message:
    'https://example.com/webhooks/starter rejected billing.plan_changed and will not be retried.',
  openUrl: 'http://localhost:3071/workspaces/starter-lab/webhooks',
  preferencesUrl:
    'http://localhost:3071/account/notifications?kind=webhook.delivery_failed'
}
MemberJoinedEmail.PreviewProps = {
  ...previewBase,
  kindLabel: 'Member joined',
  title: 'Invitation accepted',
  message: 'Taylor Morgan joined Starter Lab as a member.',
  openUrl: 'http://localhost:3071/workspaces/starter-lab/members',
  preferencesUrl:
    'http://localhost:3071/account/notifications?kind=workspace_member.joined'
}
PlanChangedEmail.PreviewProps = {
  ...previewBase,
  kindLabel: 'Plan changed',
  title: 'Plan changed to Team',
  message: 'The workspace now serves the Team plan limits.',
  openUrl: 'http://localhost:3071/workspaces/starter-lab/billing',
  preferencesUrl:
    'http://localhost:3071/account/notifications?kind=billing.plan_changed'
}
AccountImpersonatedEmail.PreviewProps = {
  ...previewBase,
  kindLabel: 'Account impersonated',
  title: 'A System Admin accessed your account',
  message:
    'Martin Brandhaug started an impersonation session on your account. It ends when they stop it or after 60 minutes.',
  workspaceName: null,
  openUrl: 'http://localhost:3071/account',
  preferencesUrl:
    'http://localhost:3071/account/notifications?kind=account.impersonated'
}
AnnouncementEmail.PreviewProps = {
  ...previewBase,
  kindLabel: 'Announcements',
  title: 'Workspace export ready',
  message: 'Your export of Starter Lab is ready to download from workspace settings.',
  openUrl: 'http://localhost:3071/workspaces/starter-lab',
  preferencesUrl: 'http://localhost:3071/account/notifications?kind=announcement'
}

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
  readonly locale?: Locale | undefined
}

function digestRowHeading(item: DigestItem): string {
  if (item.workspaceName === null) {
    return item.kindLabel
  }
  return `${item.kindLabel} · ${item.workspaceName}`
}

function DigestRow({ item }: { readonly item: DigestItem }) {
  return (
    <Section className="border-solid border-0 border-b border-border py-3">
      <Text className="text-sm text-muted-foreground m-0">
        {digestRowHeading(item)}
      </Text>
      <Text className="text-base font-medium text-foreground mt-1 mb-0">
        {item.title}
      </Text>
      <Text className="text-sm text-foreground mt-1 mb-0">{item.message}</Text>
      <Text className="text-sm text-muted-foreground mt-1 mb-0">{item.createdAt}</Text>
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
  preferencesUrl,
  locale = DEFAULT_LOCALE
}: NotificationDigestEmailProps) {
  let countLine = m.backend_email_notification_digest_many(
    { count: items.length },
    { locale }
  )
  if (items.length === 1) {
    countLine = m.backend_email_notification_digest_one({}, { locale })
  }
  return (
    <EmailLayout
      preview={m.backend_email_subject_digest({ count: items.length }, { locale })}
      heading={m.backend_email_notification_digest_heading({}, { locale })}
      locale={locale}
    >
      <Text className="text-base text-foreground mt-4">
        {m.backend_email_notification_digest_greeting(
          { recipientName, countLine },
          { locale }
        )}
      </Text>
      <Section className="mt-4">
        {items.map((item) => (
          <DigestRow key={item.id} item={item} />
        ))}
      </Section>
      <ActionLink
        href={openUrl}
        label={m.backend_email_notification_digest_open({}, { locale })}
        locale={locale}
      />
      <NotificationFooter preferencesUrl={preferencesUrl} locale={locale} />
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
      title: 'Workspace export ready',
      message:
        'Your export of Starter Lab is ready to download from workspace settings.',
      workspaceName: 'Starter Lab',
      createdAt: '2026-05-16 07:45 UTC'
    }
  ],
  openUrl: 'http://localhost:3071/workspaces',
  preferencesUrl: 'http://localhost:3071/account/notifications'
} satisfies NotificationDigestEmailProps
