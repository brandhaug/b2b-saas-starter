import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { MailIcon, ShieldCheckIcon } from 'lucide-react'
import {
  sendEmailCodeWithAuthClient,
  signInWithEmailCodeWithAuthClient,
  sixDigitCodeValidator,
  type SendEmailCode,
  type SignInWithEmailCode
} from '@/components/auth/auth-client-ports'
import { emailValidator } from '@/components/auth/auth-validators'
import { AuthCardForm } from '@/components/auth/auth-card-form'
import { OtpCodeInput } from '@/components/auth/otp-code-input'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { useResendCooldown } from '@/components/auth/use-resend-cooldown'
import { ResendCodeButton } from '@/components/auth/resend-code-button'
import { FormTextField } from '@/components/form-text-field'
import { Button } from '@/components/ui/button'
import { redirectSearch, safeRedirect } from '@/lib/utils'

export const Route = createFileRoute('/sign-in_/email-code')({
  validateSearch: redirectSearch,
  component: EmailCodeSignInRoute,
  head: () => ({ meta: [{ title: 'Sign in with a code | B2B SaaS Starter' }] })
})

function EmailCodeSignInRoute() {
  const { redirect } = Route.useSearch()
  return <EmailCodeSignInPage redirect={redirect} />
}

/**
 * The code-entry alternative to the password form on /sign-in: step one asks
 * for the email and sends a six-digit code, step two turns the code into a
 * session. Registration is not possible from here — the server's
 * `disableSignUp` refuses codes for unknown addresses, and the endpoint
 * answers identically either way, so an unknown email looks like a sent one.
 */
export function EmailCodeSignInPage({
  redirect,
  sendCode = sendEmailCodeWithAuthClient,
  signIn = signInWithEmailCodeWithAuthClient
}: {
  readonly redirect?: string | undefined
  readonly sendCode?: SendEmailCode
  readonly signIn?: SignInWithEmailCode
}) {
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const cooldown = useResendCooldown()

  const emailForm = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const result = await sendCode({ email: value.email, purpose: 'sign-in' })
      if (result.error) {
        setSubmitError(result.error.message ?? 'Could not send the code')
        return
      }
      setEmail(value.email)
      cooldown.start()
      setStep('code')
    }
  })

  const codeForm = useForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const result = await signIn({ email, otp: value.code })
      if (result.error) {
        setSubmitError(result.error.message ?? 'Verification failed')
        return
      }
      router.history.push(safeRedirect(redirect))
    }
  })

  if (step === 'email') {
    return (
      <AuthCardForm
        title="Email me a code"
        description="We will send a six-digit sign-in code to your email. It works once and expires in ten minutes."
        form={emailForm}
        submit={
          <AuthSubmitButton
            form={emailForm}
            icon={<MailIcon className="size-4" />}
            label="Email me a code"
            submittingLabel="Sending…"
          />
        }
        error={submitError}
        footer={
          <p className="text-center text-sm text-muted-foreground">
            Prefer your password?{' '}
            <Link
              to="/sign-in"
              search={redirect ? { redirect } : {}}
              className="text-primary underline underline-offset-4"
            >
              Sign in that way
            </Link>
          </p>
        }
      >
        <emailForm.Field name="email" validators={{ onChange: emailValidator }}>
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
        </emailForm.Field>
      </AuthCardForm>
    )
  }

  return (
    <AuthCardForm
      title="Enter your code"
      description={`We emailed a six-digit code to ${email}. It expires in ten minutes.`}
      form={codeForm}
      submit={
        <AuthSubmitButton
          form={codeForm}
          icon={<ShieldCheckIcon className="size-4" />}
          label="Verify and sign in"
          submittingLabel="Verifying…"
        />
      }
      error={submitError}
      footer={
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <ResendCodeButton
              cooldownSeconds={cooldown.remaining}
              onResend={async () => {
                setSubmitError(null)
                const result = await sendCode({ email, purpose: 'sign-in' })
                if (result.error) {
                  setSubmitError(result.error.message ?? 'Could not resend the code')
                  return
                }
                cooldown.start()
              }}
            />
            <Button
              type="button"
              variant="ghost"
              className="h-auto p-0 text-muted-foreground"
              onClick={() => {
                setSubmitError(null)
                codeForm.reset()
                setStep('email')
              }}
            >
              Use a different email
            </Button>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            <Link
              to="/sign-in"
              search={redirect ? { redirect } : {}}
              className="text-primary underline underline-offset-4"
            >
              Back to sign in
            </Link>
          </p>
        </div>
      }
    >
      <codeForm.Field name="code" validators={{ onChange: sixDigitCodeValidator }}>
        {(field) => (
          <OtpCodeInput
            value={field.state.value}
            onChange={field.handleChange}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the code step has exactly one field group, so focusing its first cell cannot surprise anyone mid-task
            autoFocus
          />
        )}
      </codeForm.Field>
    </AuthCardForm>
  )
}
