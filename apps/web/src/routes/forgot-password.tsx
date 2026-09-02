import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { MailQuestionIcon } from 'lucide-react'
import { AuthCardForm } from '@/components/auth/auth-card-form'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { emailValidator } from '@/components/auth/auth-validators'
import { FormTextField } from '@/components/form-text-field'
import {
  requestPasswordResetWithAuthClient,
  type RequestPasswordReset
} from '@/components/auth/auth-client-ports'

export type { RequestPasswordReset } from '@/components/auth/auth-client-ports'

export const Route = createFileRoute('/forgot-password')({
  head: () => ({ meta: [{ title: 'Forgot password | B2B SaaS Starter' }] }),
  component: ForgotPasswordRoute
})

function ForgotPasswordRoute() {
  return <ForgotPasswordPage />
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
        <p role="alert" className="text-sm text-muted-foreground">
          {SENT_MESSAGE}
        </p>
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
