import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { MailQuestionIcon } from 'lucide-react'
import { AuthCardForm } from '@/components/auth/auth-card-form'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { emailValidator } from '@/components/auth/auth-validators'
import { FormTextField } from '@/components/form-text-field'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordRoute
})

/**
 * Requesting a password reset, as a port. Injected rather than reaching for
 * the `authClient` singleton at the call site so a test drives the form with a
 * real function of this shape instead of replacing `@/lib/auth-client`.
 */
export type RequestPasswordReset = (input: {
  readonly email: string
}) => Promise<{ readonly error?: { readonly message?: string | undefined } | null }>

function ForgotPasswordRoute() {
  return <ForgotPasswordPage />
}

/**
 * Hoisted to module scope rather than written inline as a default: a new
 * function expression per render would be a fresh prop value every time.
 *
 * `redirectTo` is where Better Auth's token-exchange redirect lands once the
 * emailed link is clicked: the handler validates the token, then forwards it
 * to `/reset-password?token=…` (or `?error=INVALID_TOKEN`).
 */
function requestPasswordResetWithAuthClient(
  input: Parameters<RequestPasswordReset>[0]
): ReturnType<RequestPasswordReset> {
  return authClient.requestPasswordReset({
    email: input.email,
    redirectTo: `${window.location.origin}/reset-password`
  })
}

// One message for every outcome, by design: the endpoint answers identically
// whether or not the email exists (account enumeration defense), and the
// screen must not know more than the endpoint does.
const SENT_MESSAGE =
  'If this email exists in our system, check your inbox for a reset link. It expires in one hour.'

export function ForgotPasswordPage({
  requestReset = requestPasswordResetWithAuthClient
}: {
  readonly requestReset?: RequestPasswordReset
}) {
  const [sent, setSent] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const result = await requestReset({ email: value.email })
      if (result.error) {
        setSubmitError(result.error.message ?? 'Request failed')
        return
      }
      setSent(true)
    }
  })

  return (
    <AuthCardForm
      title="Reset your password"
      description="Enter the email you sign in with and we will send a reset link."
      // The sent state is a confirmation, not a form — no wrapper, no
      // hydration signal needed.
      form={sent ? null : form}
      submit={
        sent ? undefined : (
          <AuthSubmitButton
            form={form}
            icon={<MailQuestionIcon className="size-4" />}
            label="Send reset link"
            submittingLabel="Sending…"
          />
        )
      }
      error={submitError}
      footer={
        <p className="text-center text-sm text-muted-foreground">
          Remembered it after all?{' '}
          <Link to="/sign-in" className="text-primary underline underline-offset-4">
            Sign in
          </Link>
        </p>
      }
    >
      {sent ? (
        <p className="text-sm text-muted-foreground">{SENT_MESSAGE}</p>
      ) : (
        <form.Field name="email" validators={{ onChange: emailValidator }}>
          {(field) => (
            <FormTextField
              name={field.name}
              label="Email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={field.state.value}
              errors={field.state.meta.errors}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              required
            />
          )}
        </form.Field>
      )}
    </AuthCardForm>
  )
}
