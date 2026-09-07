import { authClient } from '@/lib/auth-client'
import { useState } from 'react'
import { m } from '@b2b-saas-starter/i18n/messages'
import { Button } from './ui/button'
import { useServerAction } from '@/hooks/use-server-action'

export function OwnEmailResend({
  email,
  verified
}: {
  readonly email: string
  readonly verified: boolean
}) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const resend = useServerAction(
    (flow: 'verification' | 'recovery') => {
      setFeedback(null)
      return flow === 'verification'
        ? authClient.sendVerificationEmail({ email, callbackURL: '/account' })
        : authClient.requestPasswordReset({ email, redirectTo: '/reset-password' })
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
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        {verified ? null : (
          <Button
            variant="outline"
            disabled={resend.pending}
            onClick={() => resend.run('verification')}
          >
            {m.email_delivery_restart_verification()}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={resend.pending}
          onClick={() => resend.run('recovery')}
        >
          {m.email_delivery_restart_recovery()}
        </Button>
      </div>
      <output className="text-sm">{resend.error ?? feedback}</output>
    </div>
  )
}
