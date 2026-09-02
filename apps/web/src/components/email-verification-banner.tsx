import { useState } from 'react'
import { MailWarningIcon } from 'lucide-react'
import {
  sendVerificationEmailWithAuthClient,
  type SendVerificationEmail
} from '@/components/auth/auth-client-ports'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export { type SendVerificationEmail }

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
