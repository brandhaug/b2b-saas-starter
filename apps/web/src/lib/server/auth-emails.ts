import { type AuthEmailSender } from '@b2b-saas-starter/auth'
import { EmailDispatcher, selectEmailDispatcherLayer } from '@b2b-saas-starter/email'
import {
  EmailVerificationEmail,
  PasswordResetEmail
} from '@b2b-saas-starter/email/templates'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { Effect } from 'effect'
import { type ReactElement } from 'react'

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
/**
 * Provider-light by the same selector the invitation flow uses (`invitations.ts`
 * imports this): with no `EMAIL` binding configured this is the logging
 * dispatcher, so password reset and email verification work end to end locally
 * without an email provider — the link lands in the console log instead of an
 * inbox.
 */
export function emailDispatcherLayer() {
  return selectEmailDispatcherLayer({
    EMAIL: cloudflareEnv.EMAIL,
    EMAIL_FROM_ADDRESS: cloudflareEnv.CLOUDFLARE_EMAIL_FROM
  })
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
  return Effect.runPromise(
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
    sendPasswordReset: ({ email, url }) =>
      dispatch({
        to: email,
        subject: 'Reset your password',
        element: PasswordResetEmail({ url })
      }),
    sendEmailVerification: ({ email, url }) =>
      dispatch({
        to: email,
        subject: 'Verify your email address',
        element: EmailVerificationEmail({ url })
      })
  }
}
