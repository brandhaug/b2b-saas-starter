import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  AuthenticationShell,
  Feedback,
  Field,
  SubmitButton
} from '@/components/operations-ui.tsx'
import { formValue } from '@/lib/form-value.ts'
import { signInOperator } from '@/lib/server/operations.ts'

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === 'string' ? search.error : undefined,
    result: typeof search.result === 'string' ? search.result : undefined
  }),
  component: SignInPage
})

function SignInPage() {
  const search = Route.useSearch()
  const [message, setMessage] = useState<string | null>(null)
  return (
    <AuthenticationShell
      description="Use your dedicated System Operator identity. Merchant credentials cannot enter this application."
      eyebrow="Dedicated auth realm"
      title="Operations sign in"
    >
      {search.error || message ? (
        <Feedback>{message ?? 'Authentication was not accepted.'}</Feedback>
      ) : null}
      {search.result === 'enrollment-complete' ? (
        <Feedback status>
          Security enrollment is complete. Sign in with your new credentials.
        </Feedback>
      ) : null}
      <form
        className="mt-6 grid gap-6"
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          setMessage(null)
          void signInOperator({
            data: {
              email: formValue(form, 'email'),
              password: formValue(form, 'password')
            }
          }).then((result) => {
            if (result.state === 'redirect') window.location.assign(result.location)
            else
              setMessage(
                'message' in result
                  ? result.message
                  : 'Authentication was not accepted.'
              )
          })
        }}
      >
        <Field label="Email" name="email" type="email" required />
        <Field label="Password" name="password" type="password" required />
        <SubmitButton>Continue</SubmitButton>
      </form>
      <p className="mt-6 text-xs text-muted-foreground">
        Access is followed by a mandatory TOTP challenge. Invitation recipients should
        use the single-use link from their email.
      </p>
      <Link className="sr-only" search={{ merchantQuery: '', memberQuery: '' }} to="/">
        Operations home
      </Link>
    </AuthenticationShell>
  )
}
