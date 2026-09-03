import { notificationKinds } from '@b2b-saas-starter/db/enums'
import { render } from '@react-email/render'
import { Effect } from 'effect'
import { type ReactElement } from 'react'
import { describe, expect, it } from 'vite-plus/test'
import {
  NOTIFICATION_EMAIL_TEMPLATES,
  NotificationDigestEmail,
  notificationEmailFor
} from './notification-emails.ts'

const props = {
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
  it('has one template per stored kind, and every one carries preview props', () => {
    for (const kind of notificationKinds) {
      const template = NOTIFICATION_EMAIL_TEMPLATES[kind]
      expect(template).toBeTypeOf('function')
      expect('PreviewProps' in template).toBe(true)
    }
  })

  it.each(notificationKinds)(
    'renders %s with the notification copy and the unsubscribe link',
    (kind) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { html, text } = yield* rendered(notificationEmailFor(kind, props))
          expect(html).toContain('Webhook delivery gave up')
          expect(html).toContain('Starter Lab')
          expect(html).toContain(props.openUrl)
          expect(html).toContain(props.preferencesUrl)
          expect(text.toLowerCase()).toContain('unsubscribe')
        })
      )
  )

  it('omits the workspace line for an account-level notification', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { html } = yield* rendered(
          notificationEmailFor('two_factor.changed', { ...props, workspaceName: null })
        )
        expect(html).not.toContain('Workspace:')
      })
    ))

  it('renders the digest with one row per item and the unsubscribe link', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { html } = yield* rendered(
          NotificationDigestEmail(NotificationDigestEmail.PreviewProps)
        )
        expect(html).toContain('Your daily notification digest')
        expect(html).toContain('2 unread notifications')
        expect(html).toContain('Webhook delivery gave up')
        expect(html).toContain('Cloudflare Email needs configuration')
        expect(html).toContain(NotificationDigestEmail.PreviewProps.preferencesUrl)
      })
    ))

  it('renders the digest for a single item with singular copy', () =>
    Effect.runPromise(
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
    ))
})
