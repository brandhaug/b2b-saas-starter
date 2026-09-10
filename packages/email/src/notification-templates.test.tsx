import { notificationKinds, type NotificationKind } from '@b2b-saas-starter/db/enums'
import { render } from 'react-email'
import { Effect } from 'effect'
import { type ReactElement } from 'react'
import { describe, expect, it } from '@effect/vitest'
import * as m from '@b2b-saas-starter/i18n/messages'
import {
  NOTIFICATION_EMAIL_COPY,
  NOTIFICATION_PREVIEW_PROPS,
  NotificationDigestEmail,
  notificationEmailFor
} from './notification-emails.ts'

const props = {
  kindLabel: 'Webhook delivery failed',
  title: 'Webhook delivery gave up',
  message: 'https://example.com/hook rejected api_token.created after six attempts.',
  workspaceName: 'Starter Lab',
  openUrl: 'https://app.example.com/workspaces/starter-lab/webhooks',
  preferencesUrl:
    'https://app.example.com/account/notifications?kind=webhook.delivery_failed'
}

/** Both renderings of one element, the same way the dispatcher produces them. */
function rendered(element: ReactElement) {
  return Effect.all({
    html: Effect.promise(() => render(element)),
    text: Effect.promise(() => render(element, { plainText: true }))
  })
}

describe('notification email templates', () => {
  it('has copy and preview props for every stored kind', () => {
    for (const kind of notificationKinds) {
      expect(NOTIFICATION_EMAIL_COPY[kind]).toBeTypeOf('function')
      expect(NOTIFICATION_PREVIEW_PROPS[kind].kindLabel.length).toBeGreaterThan(0)
    }
  })

  it.effect('gives every kind its own lead sentence', () =>
    Effect.gen(function* () {
      const announcement = m.backend_email_notification_announcement_lead(
        {},
        { locale: 'en' }
      )
      for (const kind of notificationKinds) {
        // Plain text, not HTML: the renderer escapes apostrophes in markup.
        const { text } = yield* rendered(notificationEmailFor(kind, props))
        expect(text).toContain(NOTIFICATION_EMAIL_COPY[kind]('en').lead)
        if (kind !== 'announcement') {
          // A missing entry used to fall through to the announcement wording.
          expect(text).not.toContain(announcement)
        }
      }
    })
  )

  it.effect(
    'gives every kind a representative destination and rendered fixture copy',
    () =>
      Effect.gen(function* () {
        const expected = {
          'api_token.created': '/workspaces/starter-lab/api-tokens',
          'api_token.revoked': '/workspaces/starter-lab/api-tokens',
          'workspace_member.role_changed': '/workspaces/starter-lab/members',
          'two_factor.changed': '/account',
          'webhook.delivery_failed': '/workspaces/starter-lab/webhooks',
          'workspace_member.joined': '/workspaces/starter-lab/members',
          'billing.plan_changed': '/workspaces/starter-lab/billing',
          'account.impersonated': '/account',
          announcement: '/workspaces/starter-lab'
        } satisfies Record<NotificationKind, string>

        for (const kind of notificationKinds) {
          const preview = NOTIFICATION_PREVIEW_PROPS[kind]
          expect(new URL(preview.openUrl).pathname).toBe(expected[kind])
          expect(preview.preferencesUrl).toContain(`kind=${kind}`)
          if (kind !== 'api_token.created') {
            expect(preview.kindLabel).not.toBe('API token created')
            expect(preview.title).not.toBe('API token created')
          }
          const { html, text } = yield* rendered(notificationEmailFor(kind, preview))
          expect(html).toContain(preview.kindLabel)
          expect(html).toContain(preview.title)
          expect(text).toContain(preview.message)
        }
      })
  )

  describe.each(notificationKinds)('the %s notification', (kind) => {
    it.effect('renders with the notification copy and the unsubscribe link', () =>
      Effect.gen(function* () {
        const { html, text } = yield* rendered(notificationEmailFor(kind, props))
        // The heading is the kind's shared label, not bespoke template copy.
        expect(html).toContain(`>${props.kindLabel}</`)
        expect(html).toContain('Webhook delivery gave up')
        expect(html).toContain('Starter Lab')
        expect(html).toContain(props.openUrl)
        expect(html).toContain(props.preferencesUrl)
        expect(text.toLowerCase()).toContain('unsubscribe')
      })
    )
  })

  it.effect('omits the workspace line for an account-level notification', () =>
    Effect.gen(function* () {
      const { html } = yield* rendered(
        notificationEmailFor('two_factor.changed', { ...props, workspaceName: null })
      )
      expect(html).not.toContain('Workspace:')
    })
  )

  it.effect('renders the digest with one row per item and the unsubscribe link', () =>
    Effect.gen(function* () {
      const { html } = yield* rendered(
        NotificationDigestEmail(NotificationDigestEmail.PreviewProps)
      )
      expect(html).toContain('Your daily notification digest')
      expect(html).toContain('2 unread notifications')
      expect(html).toContain('Webhook delivery gave up')
      expect(html).toContain('Workspace export ready')
      expect(html).toContain(NotificationDigestEmail.PreviewProps.preferencesUrl)
    })
  )

  it.effect('renders the digest for a single item with singular copy', () =>
    Effect.gen(function* () {
      const [first] = NotificationDigestEmail.PreviewProps.items
      if (first === undefined) {
        return yield* Effect.die('preview props need at least one item')
      }
      const { html } = yield* rendered(
        NotificationDigestEmail({
          ...NotificationDigestEmail.PreviewProps,
          items: [first]
        })
      )
      expect(html).toContain('One unread notification')
    })
  )
})

it.effect('uses Norwegian singular and plural digest subjects', () =>
  Effect.gen(function* () {
    const single = yield* rendered(
      NotificationDigestEmail({
        ...NotificationDigestEmail.PreviewProps,
        items: NotificationDigestEmail.PreviewProps.items.slice(0, 1),
        locale: 'nb'
      })
    )
    const multiple = yield* rendered(
      NotificationDigestEmail({
        ...NotificationDigestEmail.PreviewProps,
        locale: 'nb'
      })
    )
    expect(single.html).toContain('1 ulest varsel')
    expect(single.html).not.toContain('1 uleste')
    expect(multiple.html).toContain('2 uleste varsler')
  })
)
