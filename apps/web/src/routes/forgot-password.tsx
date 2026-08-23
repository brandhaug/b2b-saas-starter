import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { MailQuestionIcon } from 'lucide-react'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { emailValidator } from '@/components/auth/auth-validators'
import { FormTextField } from '@/components/form-text-field'
import { PublicLayout } from '@/components/public-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authClient } from '@/lib/auth-client'
import { useHydrated } from '@/lib/client-only-value'

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
  const hydrated = useHydrated()
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
    <PublicLayout>
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-md flex-1 place-items-center px-4 py-12"
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Reset your password</CardTitle>
            <p className="text-sm text-muted-foreground">
              Enter the email you sign in with and we will send a reset link.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            {sent ? (
              <p className="text-sm text-muted-foreground">{SENT_MESSAGE}</p>
            ) : (
              <form
                data-hydrated={hydrated ? 'true' : undefined}
                onSubmit={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void form.handleSubmit()
                }}
                className="grid gap-4"
              >
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

                <AuthSubmitButton
                  form={form}
                  icon={<MailQuestionIcon className="size-4" />}
                  label="Send reset link"
                  submittingLabel="Sending…"
                />

                {submitError ? (
                  <p className="text-xs text-destructive" role="alert">
                    {submitError}
                  </p>
                ) : null}
              </form>
            )}
            <p className="text-center text-sm text-muted-foreground">
              Remembered it after all?{' '}
              <Link to="/sign-in" className="text-primary underline underline-offset-4">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    </PublicLayout>
  )
}
