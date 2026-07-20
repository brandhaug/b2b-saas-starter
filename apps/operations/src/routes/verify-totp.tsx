import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  AuthenticationShell,
  Feedback,
  Field,
  SubmitButton
} from '@/components/operations-ui.tsx'
import { formValue } from '@/lib/form-value.ts'
import { verifyOperatorTotp } from '@/lib/server/operations-server-functions.ts'

export const Route = createFileRoute('/verify-totp')({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === 'string' ? search.error : undefined
  }),
  component: VerifyTotpPage
})

function VerifyTotpPage() {
  const { error } = Route.useSearch()
  const [message, setMessage] = useState<string | null>(null)
  return (
    <AuthenticationShell
      description="Enter the current six-digit code from your authenticator."
      eyebrow="Mandatory second factor"
      title="Verify your presence"
    >
      {error || message ? (
        <Feedback>{message ?? 'That authentication code was not accepted.'}</Feedback>
      ) : null}
      <form
        className="mt-6 grid gap-6"
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          setMessage(null)
          void verifyOperatorTotp({ data: { code: formValue(form, 'code') } }).then(
            (result) => {
              if (result.state === 'redirect') window.location.assign(result.location)
              else
                setMessage(
                  'message' in result
                    ? result.message
                    : 'That authentication code was not accepted.'
                )
            }
          )
        }}
      >
        <Field label="Authentication code" name="code" required />
        <SubmitButton>Verify and continue</SubmitButton>
      </form>
    </AuthenticationShell>
  )
}
