import { useState } from 'react'
import { pageTitle } from '@/components/page/page-title'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { KeyRoundIcon, MailQuestionIcon } from 'lucide-react'
import {
  requestPasswordResetCodeWithAuthClient,
  requestPasswordResetWithAuthClient,
  resetPasswordWithCodeWithAuthClient,
  type RequestPasswordReset,
  type RequestPasswordResetCode,
  type ResetPasswordWithCode
} from '@/components/auth/auth-client-ports'
import { emailValidator, passwordValidator } from '@/components/auth/auth-validators'
import { EmailCodeExchange } from '@/components/auth/email-code-exchange'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { FormTextField } from '@/components/form-text-field'
import { Button } from '@/components/ui/button'
import { AuthCardForm } from '@/components/auth/auth-card-form'

export type { RequestPasswordReset } from '@/components/auth/auth-client-ports'

export const Route = createFileRoute('/forgot-password')({
  head: () => ({ meta: [{ title: pageTitle('Forgot password') }] }),
  component: ForgotPasswordRoute
})

function ForgotPasswordRoute() {
  return <ForgotPasswordPage />
}

// One message for every outcome, by design: the endpoint answers identically
// whether or not the email exists (account enumeration defense), and the
// screen must not know more than the endpoint does. Thirty minutes is the
// window the auth config pins (`resetPasswordTokenExpiresIn: 60 * 30`).
const SENT_MESSAGE =
  'If this email exists in our system, check your inbox for a reset link. It expires in thirty minutes.'

// The code request endpoint holds the same non-disclosure contract, so the
// code step echoes no address either.
const CODE_SENT_MESSAGE =
  'If this email exists in our system, check your inbox for a six-digit code. It expires in ten minutes.'

/**
 * The reset surface: the emailed link (primary) or a one-time code
 * (alternative). The two paths share the email field; the code path finishes
 * on this page with a new password, the link path hands off to the emailed
 * URL. Neither path discloses whether the address is registered.
 */
export function ForgotPasswordPage({
  requestReset = requestPasswordResetWithAuthClient,
  requestCode = requestPasswordResetCodeWithAuthClient,
  resetWithCode = resetPasswordWithCodeWithAuthClient
}: {
  readonly requestReset?: RequestPasswordReset
  readonly requestCode?: RequestPasswordResetCode
  readonly resetWithCode?: ResetPasswordWithCode
}) {
  const router = useRouter()
  // `form` → the request form; `link-sent` → the link confirmation; `code` →
  // code entry plus the new password.
  const [stage, setStage] = useState<'form' | 'link-sent' | 'code'>('form')
  const [email, setEmail] = useState('')
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
      setStage('link-sent')
    }
  })

  async function sendCode(): Promise<void> {
    setSubmitError(null)
    const address = form.getFieldValue('email')
    // Only a valid address moves on; an invalid one runs the form's own
    // validators so the field shows why.
    if (emailValidator({ value: address }) !== undefined) {
      await form.handleSubmit()
      return
    }
    const result = await requestCode({ email: address })
    if (result.error) {
      setSubmitError(result.error.message ?? 'Could not send the code')
      return
    }
    setEmail(address)
    setStage('code')
  }

  if (stage === 'code') {
    return (
      <EmailCodeExchange
        purpose="forget-password"
        email={email}
        title="Enter your code"
        codeSentNotice={CODE_SENT_MESSAGE}
        codeSubmitLabel="Reset password"
        codeSubmittingLabel="Resetting…"
        codeSubmitIcon={<KeyRoundIcon className="size-4" />}
        verifyErrorFallback="Reset failed"
        // The resend re-asks the code endpoint — it takes only the address,
        // none of the shared send's purpose.
        send={({ email: address }) => requestCode({ email: address })}
        verify={({ email: address, otp, password }) =>
          resetWithCode({ email: address, otp, newPassword: password })
        }
        onVerified={() => {
          // The reset revokes every session, so a fresh sign-in is the only step.
          router.history.push('/sign-in')
        }}
        differentEmailLabel="Use the link instead"
        onDifferentEmail={() => setStage('form')}
        renderExtraFields={(codeForm) => (
          <>
            <codeForm.Field
              name="password"
              validators={{ onChange: passwordValidator }}
            >
              {(field) => (
                <FormTextField
                  name={field.name}
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  value={field.state.value}
                  errors={field.state.meta.errors}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                  required
                />
              )}
            </codeForm.Field>

            <codeForm.Field
              name="confirm"
              validators={{
                onChange: ({ value, fieldApi }) => {
                  if (value.length === 0) {
                    return 'Confirm your password'
                  }
                  if (value !== fieldApi.form.getFieldValue('password')) {
                    return 'Passwords do not match'
                  }
                  return null
                }
              }}
            >
              {(field) => (
                <FormTextField
                  name={field.name}
                  label="Confirm password"
                  type="password"
                  autoComplete="new-password"
                  value={field.state.value}
                  errors={field.state.meta.errors}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                  required
                />
              )}
            </codeForm.Field>
          </>
        )}
      />
    )
  }

  return (
    <AuthCardForm
      title="Reset your password"
      description="Enter the email you sign in with and we will send a reset link — or a one-time code."
      // The link-sent stage is a confirmation, not a form — no wrapper, no
      // hydration signal needed.
      form={stage === 'form' ? form : null}
      submit={
        stage === 'form' ? (
          <div className="grid gap-3">
            <AuthSubmitButton
              form={form}
              icon={<MailQuestionIcon className="size-4" />}
              label="Send reset link"
              submittingLabel="Sending…"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!form.state.canSubmit || form.state.isSubmitting}
              onClick={() => {
                void sendCode()
              }}
            >
              Email me a code instead
            </Button>
          </div>
        ) : undefined
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
      {stage === 'link-sent' ? (
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
