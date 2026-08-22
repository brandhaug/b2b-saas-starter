import { useState } from 'react'
import { MailWarningIcon } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from './ui/button'

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
      <output className="block rounded-none border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Verification email sent to{' '}
        <code className="rounded-sm bg-muted px-1 py-0.5 text-xs">{email}</code>. Check
        your inbox; the link expires in an hour.
      </output>
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
    <div className="flex flex-wrap items-center gap-3 rounded-none border border-border bg-muted/40 px-4 py-3">
      <MailWarningIcon className="size-4 shrink-0 text-muted-foreground" />
      <p className="flex-1 text-sm text-muted-foreground">
        Your email address is not verified yet.
        {sendError ? (
          <span role="alert" className="text-destructive">
            {' '}
            {sendError}
          </span>
        ) : null}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => void resend()}>
        Resend verification email
      </Button>
    </div>
  )
}
