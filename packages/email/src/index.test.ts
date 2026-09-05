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
  BackupCodesRotatedEmail,
  MagicLinkEmail,
  OneTimeCodeEmail,
  PasswordChangedEmail,
  PasswordResetEmail,
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

describe('PasswordResetEmail', () => {
  it('names the thirty-minute window the auth config pins', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const text = yield* Effect.promise(() =>
          render(PasswordResetEmail({ url: 'http://localhost:3071/x' }), {
            plainText: true
          })
        )
        // `resetPasswordTokenExpiresIn: 60 * 30` in packages/auth — the copy
        // is where a drift between the config and the promise would surface.
        expect(text).toContain('thirty minutes')
        expect(text).not.toContain('hour')
      })
    ))
})

describe('PasswordChangedEmail', () => {
  it.each([
    ['reset', 'Your password was reset', 'reset through the link'],
    ['password-change', 'Your password was changed', 'changed from your account']
  ] satisfies ReadonlyArray<
    readonly [via: 'reset' | 'password-change', heading: string, flow: string]
  >)('renders the %s flow, naming what happened', (via, heading, flow) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const html = yield* Effect.promise(() => render(PasswordChangedEmail({ via })))
        const text = yield* Effect.promise(() =>
          render(PasswordChangedEmail({ via }), { plainText: true })
        )
        expect(html).toContain(heading)
        expect(text.toLowerCase()).toContain(heading.toLowerCase())
        expect(text).toContain(flow)
      })
    )
  )

  it('renders no action link — a sign-in button in this email is a phishing assist', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const html = yield* Effect.promise(() =>
          render(PasswordChangedEmail({ via: 'reset' }))
        )
        expect(html).not.toContain('href=')
      })
    ))
})

describe('BackupCodesRotatedEmail', () => {
  it('warns that the previously saved codes stopped working, with no link', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const text = yield* Effect.promise(() =>
          render(BackupCodesRotatedEmail(), { plainText: true })
        )
        expect(text).toContain('stopped working')
        const html = yield* Effect.promise(() => render(BackupCodesRotatedEmail()))
        expect(html).not.toContain('href=')
      })
    ))
})
