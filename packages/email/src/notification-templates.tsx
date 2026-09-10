import { Link, Section, Text } from 'react-email'
import { type NotificationKind } from '@b2b-saas-starter/db/enums'
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

type NotificationCopyMessage = (
  inputs?: Record<string, never>,
  options?: { readonly locale?: Locale }
) => string

type NotificationCopy = {
  /** One sentence naming the event class, before the Notification's own copy. */
  readonly lead: NotificationCopyMessage
  readonly action: NotificationCopyMessage
}

/**
 * The copy each kind adds around the Notification's own title and message.
 * `satisfies`-pinned to `NotificationKind`: a new stored kind is a type error
 * until it has copy here. Never loosen it to an index signature.
 */
const NOTIFICATION_COPY = {
  'api_token.created': {
    lead: m.backend_email_notification_api_token_created_lead,
    action: m.backend_email_notification_api_token_created_action
  },
  'api_token.revoked': {
    lead: m.backend_email_notification_api_token_revoked_lead,
    action: m.backend_email_notification_api_token_revoked_action
  },
  'workspace_member.role_changed': {
    lead: m.backend_email_notification_role_changed_lead,
    action: m.backend_email_notification_role_changed_action
  },
  'two_factor.changed': {
    lead: m.backend_email_notification_two_factor_changed_lead,
    action: m.backend_email_notification_two_factor_changed_action
  },
  'webhook.delivery_failed': {
    lead: m.backend_email_notification_webhook_failed_lead,
    action: m.backend_email_notification_webhook_failed_action
  },
  'workspace_member.joined': {
    lead: m.backend_email_notification_member_joined_lead,
    action: m.backend_email_notification_member_joined_action
  },
  'billing.plan_changed': {
    lead: m.backend_email_notification_plan_changed_lead,
    action: m.backend_email_notification_plan_changed_action
  },
  'account.impersonated': {
    lead: m.backend_email_notification_impersonated_lead,
    action: m.backend_email_notification_impersonated_action
  },
  announcement: {
    lead: m.backend_email_notification_announcement_lead,
    action: m.backend_email_notification_announcement_action
  }
} satisfies Readonly<Record<NotificationKind, NotificationCopy>>

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

/**
 * The notification email, for every kind. The kind picks the lead sentence and
 * the action label; everything else is the Notification's own copy.
 */
export function NotificationEmail({
  kind,
  kindLabel,
  title,
  message,
  workspaceName,
  openUrl,
  preferencesUrl,
  locale: requestedLocale
}: NotificationEmailProps & { readonly kind: NotificationKind }) {
  const locale = requestedLocale ?? DEFAULT_LOCALE
  const copy = NOTIFICATION_COPY[kind]
  return (
    <EmailLayout preview={title} heading={kindLabel} locale={locale}>
      <Text className="text-base text-foreground mt-4">
        {copy.lead({}, { locale })}
      </Text>
      <Section className="bg-muted px-4 py-3 mt-4">
        <Text className="text-base font-medium text-foreground m-0">{title}</Text>
        <Text className="text-sm text-foreground mt-1 mb-0">{message}</Text>
        <WorkspaceLine workspaceName={workspaceName} locale={locale} />
      </Section>
      <ActionLink href={openUrl} label={copy.action({}, { locale })} locale={locale} />
      <NotificationFooter preferencesUrl={preferencesUrl} locale={locale} />
    </EmailLayout>
  )
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
