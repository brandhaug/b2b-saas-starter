import { useState } from 'react'
import { MailWarningIcon } from 'lucide-react'
import {
  sendVerificationEmailWithAuthClient,
  type SendVerificationEmail
} from '@/components/auth/auth-client-ports'
import { useTurnstileChallenge } from '@/components/auth/turnstile-challenge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { authErrorCopy } from '@/lib/auth-error-copy'
import { m } from '@b2b-saas-starter/i18n/messages'

export { type SendVerificationEmail }

/**
 * Where the app surfaces the unverified state. Verification is encouraged,
 * not enforced (the provider-light rule: local dev sends to the log, where
 * nobody could read a gating email), so this is a nudge on every workspace
 * surface, not a lock on any of them.
 */
export function EmailVerificationBanner({
  email,
  sendVerificationEmail = sendVerificationEmailWithAuthClient,
  turnstileSiteKey = null
}: {
  readonly email: string
  readonly sendVerificationEmail?: SendVerificationEmail
  /**
   * Server-provided Turnstile site key, from the loader of the route that
   * renders this banner. The send it drives (`/send-verification-email`) is a
   * mail-any-address endpoint the auth route gates when Turnstile is
   * configured; `null` renders no widget and sends no token.
   */
  readonly turnstileSiteKey?: string | null | undefined
}) {
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const challenge = useTurnstileChallenge(turnstileSiteKey)

  if (sent) {
    return (
      // `role="status"`, not the default `alert`: this text is on the page
      // from first paint, and an assertive live region interrupts on load.
      // (An <output> element is form-result semantics — wrong here.)
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see above
      <Alert role="status">
        <AlertDescription>{m.workspace_verification_sent({ email })}</AlertDescription>
      </Alert>
    )
  }

  async function resend() {
    setSendError(null)
    if (challenge.missing) {
      setSendError(challenge.missingMessage)
      return
    }
    const result = await sendVerificationEmail({
      email,
      turnstileToken: challenge.token
    })
    challenge.consume()
    if (result.error) {
      setSendError(authErrorCopy(result.error, m.public_auth_send_email_failed()))
      return
    }
    setSent(true)
  }

  return (
    // `role="status"`: the banner renders on every page load for an
    // unverified user — `role="alert"` would interrupt on load.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see above
    <Alert role="status" icon={<MailWarningIcon />}>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span className="flex-1">
          {m.workspace_email_unverified()}
          {sendError ? (
            <span role="alert" className="text-destructive">
              {' '}
              {sendError}
            </span>
          ) : null}
        </span>
        {challenge.widget}
        <Button type="button" variant="outline" onClick={() => void resend()}>
          {m.workspace_resend_verification()}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
