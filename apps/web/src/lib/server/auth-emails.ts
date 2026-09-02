import { type AuthEmailSender } from '@b2b-saas-starter/auth'
import { EmailDispatcher, selectEmailDispatcherLayer } from '@b2b-saas-starter/email'
import {
  EmailVerificationEmail,
  PasswordResetEmail,
  TwoFactorChangedEmail
} from '@b2b-saas-starter/email/templates'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { Effect, type Layer } from 'effect'
import { type ReactElement } from 'react'

import { webRuntime } from '../observability'

/**
 * The adapter that lets Better Auth's account-lifecycle callbacks reach the
 * email system. `packages/auth` declares the `AuthEmailSender` port because it
 * cannot import the sibling `email` package (ADR 0051's rule runs in both
 * directions); this module is the app's side of that seam.
 *
 * Provider-light by the same selector the invitation flow uses: with no
 * `EMAIL` binding configured this is the logging dispatcher, so password reset
 * and email verification work end to end locally without an email provider —
 * the link lands in the console log instead of an inbox.
 *
 * Unlike `sendInvitation`, a send failure here is not downgraded to a
 * `delivered: false` result: Better Auth's endpoints have no honest "sent but
 * not really" response, so the rejection propagates and the endpoint fails.
 * The log-mode dispatcher never fails; only a real, broken `EMAIL` binding
 * can, and failing loudly there is the honest behavior.
 */
let selected: Layer.Layer<EmailDispatcher> | undefined

/**
 * Provider-light by the same selector the invitation flow uses (`invitations.ts`
 * imports this): with no `EMAIL` binding configured this is the logging
 * dispatcher, so password reset and email verification work end to end locally
 * without an email provider — the link lands in the console log instead of an
 * inbox.
 *
 * Selected once per isolate, not once per send. Which dispatcher is right is a
 * function of the isolate's env bag, which cannot change under it, and the
 * layer is a `Layer.succeed` closing over the `EMAIL` binding — no I/O state of
 * its own, so it is isolate-safe for the same reason `WideEventLoggerLive` is.
 * The read stays behind the function so importing this module in an
 * environment without bindings does not touch env, exactly like
 * `AuthConfigLive`'s `Layer.sync`.
 */
export function emailDispatcherLayer(): Layer.Layer<EmailDispatcher> {
  // The env bag goes through as it is: `EmailDispatcherEnv` names the same
  // `CLOUDFLARE_EMAIL_FROM` the schema and the deploy do, so there is no
  // second name to translate between.
  selected ??= selectEmailDispatcherLayer(cloudflareEnv)
  return selected
}

function dispatch(input: {
  readonly to: string
  readonly subject: string
  readonly element: ReactElement
}): Promise<void> {
  const dispatcher = Effect.flatMap(EmailDispatcher, (service) =>
    service.send({
      from: '',
      to: input.to,
      subject: input.subject,
      element: input.element
    })
  )
  // `webRuntime`, like every other server run in this app: the dispatcher's
  // own `email.dispatched` line then goes out through the app's console JSON
  // logger instead of Effect's default one. A rejection still propagates — the
  // auth endpoints have no honest "sent but not really" response.
  return webRuntime.runPromise(
    Effect.asVoid(dispatcher).pipe(Effect.provide(emailDispatcherLayer()))
  )
}

/**
 * The `AuthEmailSender` the auth runtime provides. Subjects live here, beside
 * the other email senders, rather than in the auth package: the wording is the
 * app's voice, not the auth server's contract.
 */
export function makeAuthEmailSender(): AuthEmailSender {
  return {
    sendResetPassword: ({ user, url }) =>
      dispatch({
        to: user.email,
        subject: 'Reset your password',
        element: PasswordResetEmail({ url })
      }),
    sendVerificationEmail: ({ user, url }) =>
      dispatch({
        to: user.email,
        subject: 'Verify your email address',
        element: EmailVerificationEmail({ url })
      })
  }
}

/**
 * The two-factor security notification (`two-factor-notification.ts` drives
 * it): best-effort by contract, so a dispatcher rejection never fails the
 * enable/disable exchange it observes — the caller swallows it.
 */
export function sendTwoFactorChangedEmail(input: {
  readonly email: string
  readonly enabled: boolean
}): Promise<void> {
  return dispatch({
    to: input.email,
    subject: 'Two-factor authentication changed',
    element: TwoFactorChangedEmail({ enabled: input.enabled })
  })
}
