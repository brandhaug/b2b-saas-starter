import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { useForm } from '@tanstack/react-form'
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  MailIcon,
  ShieldCheckIcon
} from 'lucide-react'
import {
  sendEmailCodeWithAuthClient,
  verifyEmailWithCodeWithAuthClient,
  sixDigitCodeValidator,
  type SendEmailCode,
  type VerifyEmailWithCode
} from '@/components/auth/auth-client-ports'
import { emailValidator } from '@/components/auth/auth-validators'
import { OtpCodeInput } from '@/components/auth/otp-code-input'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { useResendCooldown } from '@/components/auth/use-resend-cooldown'
import { ResendCodeButton } from '@/components/auth/resend-code-button'
import { FormTextField } from '@/components/form-text-field'
import { PublicLayout } from '@/components/public-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { pickOptionalStrings } from '@/lib/utils'

export const Route = createFileRoute('/verify-email')({
  validateSearch: (search) => pickOptionalStrings(search, ['error']),
  component: VerifyEmailRoute,
  head: () => ({ meta: [{ title: pageTitle('Verify email') }] })
})

/**
 * The landing page for the verification link. The emailed URL points at the
 * auth handler, which verifies the token and redirects here — success arrives
 * with no params (and a session cookie, via autoSignInAfterVerification),
 * failure with `?error=<code>`. This page reports what already happened, and
 * on failure offers the code as the alternative way to verify.
 */
function VerifyEmailRoute() {
  const { error } = Route.useSearch()
  return <VerifyEmailPage error={error} />
}

export function VerifyEmailPage({
  error,
  sendCode = sendEmailCodeWithAuthClient,
  verifyCode = verifyEmailWithCodeWithAuthClient
}: {
  readonly error?: string | undefined
  readonly sendCode?: SendEmailCode
  readonly verifyCode?: VerifyEmailWithCode
}) {
  return (
    <PublicLayout>
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-md flex-1 gap-4 px-4 py-12"
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle as="h1">
              {error ? (
                <span className="flex items-center gap-2">
                  <CircleAlertIcon className="size-5 text-destructive" />
                  Verification failed
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <CheckCircle2Icon className="size-5 text-primary" />
                  Email verified
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {error ? (
              <>
                <p className="text-sm text-muted-foreground">
                  This verification link is invalid or has expired. Links work once and
                  expire after an hour.
                </p>
                <p className="text-sm text-muted-foreground">
                  Still signed in? The banner on your workspaces page can send a fresh
                  link.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your email address is verified. You are signed in and ready to go.
              </p>
            )}
            <p className="text-center text-sm text-muted-foreground">
              <Link
                to="/workspaces"
                className="text-primary underline underline-offset-4"
              >
                Go to your workspaces
              </Link>
            </p>
          </CardContent>
        </Card>
        {error ? (
          <VerifyEmailCodeCard sendCode={sendCode} verifyCode={verifyCode} />
        ) : null}
      </main>
    </PublicLayout>
  )
}

/**
 * The code alternative to the failed link: email → code → verified, on the
 * same page. The endpoint answers identically for unknown addresses, so the
 * flow never confirms whether an account exists.
 */
function VerifyEmailCodeCard({
  sendCode,
  verifyCode
}: {
  readonly sendCode: SendEmailCode
  readonly verifyCode: VerifyEmailWithCode
}) {
  const router = useRouter()
  const [sentEmail, setSentEmail] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const cooldown = useResendCooldown()

  const emailForm = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const result = await sendCode({
        email: value.email,
        purpose: 'email-verification'
      })
      if (result.error) {
        setSubmitError(result.error.message ?? 'Could not send the code')
        return
      }
      setSentEmail(value.email)
      cooldown.start()
    }
  })

  const codeForm = useForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      if (sentEmail === null) {
        return
      }
      setSubmitError(null)
      const result = await verifyCode({ email: sentEmail, otp: value.code })
      if (result.error) {
        setSubmitError(result.error.message ?? 'Verification failed')
        return
      }
      // autoSignInAfterVerification means the verify response carries the
      // session cookie; a reload picks it up. The workspaces index is where
      // the session lands everywhere else.
      router.history.push('/workspaces')
    }
  })

  async function resend() {
    if (sentEmail === null) {
      return
    }
    setSubmitError(null)
    const result = await sendCode({ email: sentEmail, purpose: 'email-verification' })
    if (result.error) {
      setSubmitError(result.error.message ?? 'Could not resend the code')
      return
    }
    cooldown.start()
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle as="h2">Or verify with a code</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {sentEmail === null ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void emailForm.handleSubmit()
            }}
            className="grid gap-4"
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
            <AuthSubmitButton
              form={emailForm}
              icon={<MailIcon className="size-4" />}
              label="Email me a code"
              submittingLabel="Sending…"
            />
            {submitError ? (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            ) : null}
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void codeForm.handleSubmit()
            }}
            className="grid gap-4"
          >
            <p className="text-sm text-muted-foreground">
              We emailed a six-digit code. It expires in ten minutes.
            </p>
            <codeForm.Field
              name="code"
              validators={{ onChange: sixDigitCodeValidator }}
            >
              {(field) => (
                <OtpCodeInput
                  value={field.state.value}
                  onChange={field.handleChange}
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- the code card has exactly one field group, so focusing its first cell cannot surprise anyone mid-task
                  autoFocus
                />
              )}
            </codeForm.Field>
            <div className="flex items-center justify-between">
              <ResendCodeButton
                cooldownSeconds={cooldown.remaining}
                onResend={resend}
              />
              <Button
                type="button"
                variant="ghost"
                className="h-auto p-0 text-muted-foreground"
                onClick={() => {
                  setSubmitError(null)
                  codeForm.reset()
                  setSentEmail(null)
                }}
              >
                Use a different email
              </Button>
            </div>
            <AuthSubmitButton
              form={codeForm}
              icon={<ShieldCheckIcon className="size-4" />}
              label="Verify email"
              submittingLabel="Verifying…"
            />
            {submitError ? (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
  )
}
