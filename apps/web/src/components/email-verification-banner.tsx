import { useState } from 'react'
import { MailWarningIcon } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * Resending the verification email, as a port. Injected rather than reaching
 * for the `authClient` singleton at the call site so a test drives the banner
 * with a real function of this shape instead of replacing `@/lib/auth-client`.
 */
export type SendVerificationEmail = (input: {
  readonly email: string
}) => Promise<{ readonly error?: { readonly message?: string | undefined } | null }>

/**
 * Hoisted to module scope rather than written inline as a default: a new
 * function expression per render would be a fresh prop value every time.
 *
 * `callbackURL` is where Better Auth's verification redirect lands after the
 * emailed token is exchanged — without it the user would be dropped on '/'.
 */
function sendVerificationEmailWithAuthClient(
  input: Parameters<SendVerificationEmail>[0]
): ReturnType<SendVerificationEmail> {
  return authClient.sendVerificationEmail({
    email: input.email,
    callbackURL: `${window.location.origin}/verify-email`
  })
}

/**
 * Where the app surfaces the unverified state. Verification is encouraged,
 * not enforced (the provider-light rule: local dev sends to the log, where
 * nobody could read a gating email), so this is a nudge on every workspace
 * surface, not a lock on any of them.
 */
export function EmailVerificationBanner({
  email,
  sendVerificationEmail = sendVerificationEmailWithAuthClient
}: {
  readonly email: string
  readonly sendVerificationEmail?: SendVerificationEmail
}) {
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  if (sent) {
    return (
      <Alert>
        <AlertDescription>
          Verification email sent to{' '}
          <code className="rounded-sm bg-muted px-1 py-0.5 text-xs">{email}</code>.
          Check your inbox; the link expires in an hour.
        </AlertDescription>
      </Alert>
    )
  }

  async function resend() {
    setSendError(null)
    const result = await sendVerificationEmail({ email })
    if (result.error) {
      setSendError(result.error.message ?? 'Could not send the email')
      return
    }
    setSent(true)
  }

  return (
    <Alert>
      <MailWarningIcon />
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span className="flex-1">
          Your email address is not verified yet.
          {sendError ? (
            <span role="alert" className="text-destructive">
              {' '}
              {sendError}
            </span>
          ) : null}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => void resend()}>
          Resend verification email
        </Button>
      </AlertDescription>
    </Alert>
  )
}
