import { Effect } from 'effect'
import { render } from '@react-email/render'
import { describe, expect, it, vi } from 'vite-plus/test'
import {
  EmailDispatcher,
  LogEmailDispatcherLayer,
  makeCloudflareEmailDispatcherLayer,
  type SendEmailBinding,
  type SendEmailBuilderArgs
} from './index.ts'
import {
  MagicLinkEmail,
  OneTimeCodeEmail,
  WorkspaceInvitationEmail
} from './templates.tsx'

describe('EmailDispatcher', () => {
  it('logs delivery when no binding is configured', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* EmailDispatcher
        const result = yield* dispatcher.send({
          from: 'noreply@example.com',
          to: 'user@example.com',
          subject: 'You are invited',
          element: WorkspaceInvitationEmail({
            workspaceName: 'Starter Lab',
            inviteUrl: 'https://example.com/accept'
          })
        })
        expect(result).toEqual({
          mode: 'log',
          to: 'user@example.com',
          subject: 'You are invited'
        })
      }).pipe(Effect.provide(LogEmailDispatcherLayer))
    ))

  it('renders both html and text, then forwards to the binding', () => {
    const send = vi.fn<(message: SendEmailBuilderArgs) => Promise<void>>(() =>
      Promise.resolve()
    )
    const binding: SendEmailBinding = { send }

    return Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* EmailDispatcher
        const result = yield* dispatcher.send({
          from: 'noreply@example.com',
          to: 'user@example.com',
          subject: 'Hello from the starter',
          element: WorkspaceInvitationEmail({
            workspaceName: 'Acme',
            inviteUrl: 'https://example.com/accept'
          })
        })

        expect(send).toHaveBeenCalledTimes(1)
        const sent = send.mock.calls[0]?.[0]
        expect(sent?.from).toBe('noreply@example.com')
        expect(sent?.to).toBe('user@example.com')
        expect(sent?.subject).toBe('Hello from the starter')
        expect(sent?.html).toContain('Acme')
        expect(sent?.html).toContain('https://example.com/accept')
        expect(sent?.text?.toLowerCase()).toContain('acme')
        expect(result.mode).toBe('cloudflare-email')
      }).pipe(Effect.provide(makeCloudflareEmailDispatcherLayer(binding)))
    )
  })
})

describe('OneTimeCodeEmail', () => {
  // The purposes the starter's UI sends; `change-email` has no UI surface.
  type SentPurpose = 'sign-in' | 'email-verification' | 'forget-password'
  type PurposeCase = readonly [purpose: SentPurpose, heading: string]

  it.each([
    ['sign-in', 'Sign in to B2B SaaS Starter'],
    ['email-verification', 'Verify your email address'],
    ['forget-password', 'Reset your password']
  ] satisfies ReadonlyArray<PurposeCase>)(
    'renders the %s code and its purpose',
    (purpose, heading) =>
      Effect.gen(function* () {
        const html = yield* Effect.promise(() =>
          render(OneTimeCodeEmail({ code: '034135', purpose }))
        )
        const text = yield* Effect.promise(() =>
          render(OneTimeCodeEmail({ code: '034135', purpose }), { plainText: true })
        )
        // The code itself is the payload: it must survive both renders intact.
        expect(html).toContain('034135')
        expect(text).toContain('034135')
        expect(html).toContain(heading)
        // react-email's plain-text pass uppercases headings.
        expect(text.toLowerCase()).toContain(heading.toLowerCase())
        // The stated limits are the plugin's own; the copy is where a drift
        // between them and the email would be caught first.
        expect(text).toContain('ten minutes')
        expect(text).toContain('three failed attempts')
      }).pipe(Effect.runPromise)
  )

  it('renders no action link — the code is the payload, not a click-through', () =>
    Effect.gen(function* () {
      const html = yield* Effect.promise(() =>
        render(OneTimeCodeEmail({ code: '034135', purpose: 'sign-in' }))
      )
      expect(html).not.toContain('href=')
    }).pipe(Effect.runPromise))
})

describe('MagicLinkEmail', () => {
  it('renders html and text that both carry the sign-in link', () => {
    const send = vi.fn<(message: SendEmailBuilderArgs) => Promise<void>>(() =>
      Promise.resolve()
    )

    return Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* EmailDispatcher
        yield* dispatcher.send({
          from: 'noreply@example.com',
          to: 'user@example.com',
          subject: 'Your sign-in link',
          element: MagicLinkEmail({
            url: 'http://localhost:3071/api/auth/magic-link/verify?token=tok'
          })
        })

        const sent = send.mock.calls[0]?.[0]
        expect(sent?.html).toContain(
          'http://localhost:3071/api/auth/magic-link/verify?token=tok'
        )
        expect(sent?.html).toContain('ten minutes')
        expect(sent?.text).toContain(
          'http://localhost:3071/api/auth/magic-link/verify?token=tok'
        )
      }).pipe(Effect.provide(makeCloudflareEmailDispatcherLayer({ send })))
    )
  })
})
