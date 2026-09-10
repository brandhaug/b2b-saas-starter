import { useState } from 'react'
import { pageTitle } from '@/components/page/page-title'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { KeyRoundIcon, MailQuestionIcon } from 'lucide-react'
import {
  requestPasswordResetCodeWithAuthClient,
  requestPasswordResetWithAuthClient,
  type RequestPasswordReset,
  type RequestPasswordResetCode
} from '@/components/auth/auth-client-ports'
import { useTurnstileChallenge } from '@/components/auth/turnstile-challenge'
import { emailValidator, passwordValidator } from '@/components/auth/auth-validators'
import { EmailCodeExchangePage } from '@/components/auth/email-code-exchange'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { FormTextField } from '@/components/form-text-field'
import { Button } from '@/components/ui/button'
import { AuthCardForm, AuthNoticeCard } from '@/components/auth/auth-card-form'
import { authClient } from '@/lib/auth-client'
import { authErrorCopy } from '@/lib/auth-error-copy'
import { getTurnstileSiteKey } from '@/lib/server/turnstile'
import { m } from '@b2b-saas-starter/i18n/messages'

export type { RequestPasswordReset } from '@/components/auth/auth-client-ports'

export const Route = createFileRoute('/forgot-password')({
  // Server-only read, env-gated: with TURNSTILE unset the key is `null`, no
  // widget renders and the auth route's gate stays inactive.
  loader: () => getTurnstileSiteKey(),
  head: () => ({ meta: [{ title: pageTitle(m.public_meta_forgot_password()) }] }),
  component: ForgotPasswordRoute
})

function ForgotPasswordRoute() {
  return <ForgotPasswordPage turnstileSiteKey={Route.useLoaderData()} />
}

/**
 * The reset surface: the emailed link (primary) or a one-time code
 * (alternative). The two paths share the email field; the code path finishes
 * on this page with a new password, the link path hands off to the emailed
 * URL. Neither path discloses whether the address is registered.
 */
export function ForgotPasswordPage({
  requestReset = requestPasswordResetWithAuthClient,
  requestResetCode = requestPasswordResetCodeWithAuthClient,
  turnstileSiteKey = null
}: {
  /** The link request, injectable because the adapter composes the redirect. */
  readonly requestReset?: RequestPasswordReset
  /** The code request, injectable for the same reason as the link one. */
  readonly requestResetCode?: RequestPasswordResetCode
  /** Server-provided Turnstile site key; `null` renders no widget (provider-light). */
  readonly turnstileSiteKey?: string | null | undefined
}) {
  const router = useRouter()
  // `form` → the request form; `link-sent` → the link confirmation; `code` →
  // code entry plus the new password.
  const [stage, setStage] = useState<'form' | 'link-sent' | 'code'>('form')
  const [email, setEmail] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const challenge = useTurnstileChallenge(turnstileSiteKey)

  const form = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      if (challenge.missing) {
        setSubmitError(challenge.missingMessage)
        return
      }
      const result = await requestReset({
        email: value.email,
        turnstileToken: challenge.token
      })
      // Single-use: the code button below needs its own challenge.
      challenge.consume()
      if (result.error) {
        setSubmitError(authErrorCopy(result.error, m.public_auth_request_failed()))
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
    if (challenge.missing) {
      setSubmitError(challenge.missingMessage)
      return
    }
    const result = await requestResetCode({
      email: address,
      turnstileToken: challenge.token
    })
    challenge.consume()
    if (result.error) {
      setSubmitError(authErrorCopy(result.error, m.public_auth_send_code_failed()))
      return
    }
    setEmail(address)
    setStage('code')
  }

  if (stage === 'code') {
    return (
      <EmailCodeExchangePage
        purpose="forget-password"
        email={email}
        turnstileSiteKey={turnstileSiteKey}
        title={m.enter_your_code()}
        // The code request endpoint holds the same non-disclosure contract
        // as the emailed link, so the code step echoes no address either.
        codeSentNotice={m.reset_code_sent_notice()}
        codeSubmitLabel={m.form_reset_password()}
        codeSubmittingLabel={m.resetting()}
        codeSubmitIcon={<KeyRoundIcon className="size-4" />}
        verifyErrorFallback={m.reset_failed()}
        // The resend re-asks the code endpoint — it takes only the address
        // and the challenge, none of the shared send's purpose.
        send={({ email: address, turnstileToken }) =>
          requestResetCode({ email: address, turnstileToken })
        }
        verify={({ email: address, otp, password }) =>
          authClient.emailOtp.resetPassword({
            email: address,
            otp,
            password
          })
        }
        onVerified={() => {
          // The reset revokes every session, so a fresh sign-in is the only step.
          router.history.push('/sign-in')
        }}
        differentEmailLabel={m.use_link_instead()}
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
                  label={m.form_new_password()}
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
                    return m.form_confirm_password()
                  }
                  if (value !== fieldApi.form.getFieldValue('password')) {
                    return m.passwords_do_not_match()
                  }
                  return null
                }
              }}
            >
              {(field) => (
                <FormTextField
                  name={field.name}
                  label={m.form_confirm_password()}
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

  if (stage === 'link-sent') {
    return (
      <AuthNoticeCard
        title={m.reset_your_password()}
        description={m.reset_password_description()}
        footer={
          <p className="text-center text-sm text-muted-foreground">
            {m.remembered_it()}{' '}
            <Link to="/sign-in" className="text-primary underline underline-offset-4">
              {m.form_sign_in()}
            </Link>
          </p>
        }
      >
        {/* One message for every outcome, by design: the endpoint answers
            identically whether or not the email exists (account enumeration
            defense), and the screen must not know more than the endpoint
            does. Thirty minutes is the window the auth config pins
            (`resetPasswordTokenExpiresIn: 60 * 30`). */}
        <p role="alert" className="text-sm text-muted-foreground">
          {m.reset_link_sent_notice()}
        </p>
      </AuthNoticeCard>
    )
  }

  return (
    <AuthCardForm
      title={m.reset_your_password()}
      description={m.reset_password_description()}
      // The link-sent stage is a confirmation, not a form — no wrapper, no
      // hydration signal needed.
      form={form}
      submit={
        <div className="grid gap-3">
          <AuthSubmitButton
            form={form}
            icon={<MailQuestionIcon className="size-4" />}
            label={m.form_send_reset_link()}
            submittingLabel={m.sending()}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={!form.state.canSubmit || form.state.isSubmitting}
            onClick={() => {
              void sendCode()
            }}
          >
            {m.email_code_instead()}
          </Button>
        </div>
      }
      error={submitError}
      footer={
        <p className="text-center text-sm text-muted-foreground">
          {m.remembered_it()}{' '}
          <Link to="/sign-in" className="text-primary underline underline-offset-4">
            {m.form_sign_in()}
          </Link>
        </p>
      }
    >
      <form.Field name="email" validators={{ onChange: emailValidator }}>
        {(field) => (
          <FormTextField
            name={field.name}
            label={m.form_email()}
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
      {challenge.widget}
    </AuthCardForm>
  )
}
