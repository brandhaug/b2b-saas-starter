import { useState } from 'react'
import { m } from '@b2b-saas-starter/i18n/messages'
import {
  requestPasswordResetWithAuthClient,
  sendVerificationEmailWithAuthClient,
  type RequestPasswordReset,
  type SendVerificationEmail
} from '@/components/auth/auth-client-ports'
import { useTurnstileChallenge } from '@/components/auth/turnstile-challenge'
import { Button } from './ui/button'
import { useServerAction } from '@/hooks/use-server-action'

export { type RequestPasswordReset, type SendVerificationEmail }

/**
 * The account page's two "send it again" buttons. Both hit gated auth
 * endpoints (`/send-verification-email`, `/request-password-reset`), so they
 * go through the shared ports rather than the client directly: those ports
 * carry the `x-turnstile-token` header the auth route demands once Turnstile
 * is configured. With it unconfigured `turnstileSiteKey` is `null`, no widget
 * renders and no token is sent — the buttons behave exactly as before.
 */
export function OwnEmailResend({
  email,
  verified,
  turnstileSiteKey = null,
  sendVerificationEmail = sendVerificationEmailWithAuthClient,
  requestReset = requestPasswordResetWithAuthClient
}: {
  readonly email: string
  readonly verified: boolean
  /** Server-provided Turnstile site key; `null` renders no widget (provider-light). */
  readonly turnstileSiteKey?: string | null | undefined
  readonly sendVerificationEmail?: SendVerificationEmail
  readonly requestReset?: RequestPasswordReset
}) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const challenge = useTurnstileChallenge(turnstileSiteKey)
  const resend = useServerAction(
    (flow: 'verification' | 'recovery') => {
      setFeedback(null)
      const turnstileToken = challenge.token
      // Single-use: the second button needs its own challenge.
      challenge.consume()
      return flow === 'verification'
        ? sendVerificationEmail({ email, callbackPath: '/account', turnstileToken })
        : requestReset({ email, turnstileToken })
    },
    {
      failureMessage: m.email_delivery_resend_failed(),
      onSuccess: (result) => {
        setFeedback(
          result.error
            ? m.email_delivery_resend_failed()
            : m.email_delivery_resend_requested()
        )
      }
    }
  )

  function run(flow: 'verification' | 'recovery'): void {
    if (challenge.missing) {
      setFeedback(challenge.missingMessage)
      return
    }
    resend.run(flow)
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        {verified ? null : (
          <Button
            variant="outline"
            disabled={resend.pending}
            onClick={() => run('verification')}
          >
            {m.email_delivery_restart_verification()}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={resend.pending}
          onClick={() => run('recovery')}
        >
          {m.email_delivery_restart_recovery()}
        </Button>
      </div>
      {challenge.widget}
      <output className="text-sm">{resend.error ?? feedback}</output>
    </div>
  )
}
