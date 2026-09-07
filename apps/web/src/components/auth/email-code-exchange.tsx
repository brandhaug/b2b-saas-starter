import { useState, type ReactNode } from 'react'
import {
  useForm,
  type FormAsyncValidateOrFn,
  type FormValidateOrFn,
  type ReactFormExtendedApi
} from '@tanstack/react-form'
import { MailIcon, ShieldCheckIcon } from 'lucide-react'
import {
  sixDigitCodeValidator,
  type EmailCodePurpose
} from '@/components/auth/auth-client-ports'
import { emailValidator } from '@/components/auth/auth-validators'
import { AuthCardForm } from '@/components/auth/auth-card-form'
import { OtpCodeInput } from '@/components/auth/otp-code-input'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { useResendCooldown } from '@/components/auth/use-resend-cooldown'
import { ResendCodeButton } from '@/components/auth/resend-code-button'
import { FormTextField } from '@/components/form-text-field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authClient } from '@/lib/auth-client'
import { type AuthResult } from '@/lib/auth-result'
import { authErrorCopy } from '@/lib/auth-error-copy'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * The first hop of the exchange as the flow drives it: the address a code is
 * sent to and the flow's `purpose`. The envelope is Better Auth's
 * `{ data, error }`. A flow that already holds the address (the reset
 * page's fused request form) can override `send` to re-ask its own endpoint.
 */
export type SendEmailCode = (input: {
  readonly email: string
  readonly purpose: EmailCodePurpose
}) => Promise<AuthResult<unknown>>

/** The exchange's own send: the client's one-time-code endpoint. */
function sendEmailCodeWithAuthClient(input: {
  readonly email: string
  readonly purpose: EmailCodePurpose
}): Promise<AuthResult<unknown>> {
  return authClient.emailOtp.sendVerificationOtp({
    email: input.email,
    type: input.purpose
  })
}

/**
 * The second hop of the exchange, as the flow drives it: the address a code
 * was sent to, the entered code, and the extra fields' value (the new
 * password on the reset flow — an empty string for flows without extra
 * fields). The envelope is Better Auth's `{ data, error }`.
 */
export type VerifyEmailCode = (input: {
  readonly email: string
  readonly otp: string
  readonly password: string
}) => Promise<AuthResult<unknown>>

/** The code form's values. `password`/`confirm` are only rendered by a flow
 * that passes `renderExtraFields`; they stay empty otherwise. */
type EmailCodeValues = {
  readonly code: string
  readonly password: string
  readonly confirm: string
}

const DEFAULT_VALUES: EmailCodeValues = { code: '', password: '', confirm: '' }

/** What an extra-fields slot renders against (the shared code form, exactly
 * as `useForm` infers it — no form-level validators, no submit meta). */
type EmailCodeFormApi = ReactFormExtendedApi<
  EmailCodeValues,
  FormValidateOrFn<EmailCodeValues> | undefined,
  FormValidateOrFn<EmailCodeValues> | undefined,
  FormAsyncValidateOrFn<EmailCodeValues> | undefined,
  FormValidateOrFn<EmailCodeValues> | undefined,
  FormAsyncValidateOrFn<EmailCodeValues> | undefined,
  FormValidateOrFn<EmailCodeValues> | undefined,
  FormAsyncValidateOrFn<EmailCodeValues> | undefined,
  FormValidateOrFn<EmailCodeValues> | undefined,
  FormAsyncValidateOrFn<EmailCodeValues> | undefined,
  FormAsyncValidateOrFn<EmailCodeValues> | undefined,
  unknown
>

/**
 * The email → six-digit-code exchange three auth surfaces share: step one
 * asks for the email and sends a code (`send`, with the flow's `purpose`),
 * step two exchanges it (`verify`) and hands off to `onVerified`. Owns the
 * whole state machine — the non-disclosing sent state, the visible resend
 * cooldown, the "use a different email" reset, and the failure copy
 * (`authErrorCopy`, the shared code table, with each flow's fallback) — so
 * the routes only supply the ports and the copy.
 *
 * `email` presets the address (the reset flow collects it in its fused
 * request form, so its exchange starts on the code step); without it the
 * flow starts on the email step.
 */
type EmailCodeExchangeProps = {
  readonly purpose: EmailCodePurpose
  readonly send?: SendEmailCode
  readonly verify: VerifyEmailCode
  readonly onVerified: () => void
  /** A code was already sent here — start on the code step. */
  readonly email?: string
  /** The code step's heading. */
  readonly title: string
  readonly emailTitle?: string
  readonly emailDescription?: string
  readonly emailFooter?: ReactNode
  /** The sent confirmation's static text. */
  readonly codeSentNotice: string
  /** When set and an address is known, its text wins over the static one. */
  readonly codeSentNoticeFor?: (email: string) => string
  readonly codeSubmitLabel: string
  readonly codeSubmittingLabel: string
  readonly codeSubmitIcon?: ReactNode
  /** Rendered under the resend row in the page footer. */
  readonly codeFooter?: ReactNode
  readonly verifyErrorFallback?: string
  /** Extra fields between the code input and the submit button. */
  readonly renderExtraFields?: (form: EmailCodeFormApi) => ReactNode
  readonly differentEmailLabel?: string
  /** Overrides the built-in return to the email step. */
  readonly onDifferentEmail?: () => void
}

function useEmailCodeExchange({
  purpose,
  send = sendEmailCodeWithAuthClient,
  verify,
  onVerified,
  email,
  codeSentNotice,
  codeSentNoticeFor,
  verifyErrorFallback = m.public_auth_verification_failed(),
  differentEmailLabel = m.use_different_email(),
  onDifferentEmail
}: EmailCodeExchangeProps) {
  const [step, setStep] = useState<'email' | 'code'>(
    email === undefined ? 'email' : 'code'
  )
  const [sentEmail, setSentEmail] = useState<string | null>(email ?? null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const cooldown = useResendCooldown()

  const emailForm = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const result = await send({ email: value.email, purpose })
      if (result.error) {
        setSubmitError(authErrorCopy(result.error, m.public_auth_send_code_failed()))
        return
      }
      setSentEmail(value.email)
      cooldown.start()
      setStep('code')
    }
  })

  const codeForm = useForm({
    defaultValues: DEFAULT_VALUES,
    onSubmit: async ({ value }) => {
      if (sentEmail === null) {
        return
      }
      setSubmitError(null)
      const result = await verify({
        email: sentEmail,
        otp: value.code,
        password: value.password
      })
      if (result.error) {
        setSubmitError(authErrorCopy(result.error, verifyErrorFallback))
        return
      }
      onVerified()
    }
  })

  async function resend(): Promise<void> {
    if (sentEmail === null) {
      return
    }
    setSubmitError(null)
    const result = await send({ email: sentEmail, purpose })
    if (result.error) {
      setSubmitError(authErrorCopy(result.error, m.public_auth_resend_code_failed()))
      return
    }
    cooldown.start()
  }

  function switchToEmailStep(): void {
    setSubmitError(null)
    codeForm.reset()
    if (onDifferentEmail) {
      onDifferentEmail()
      return
    }
    setSentEmail(null)
    setStep('email')
  }

  function noticeText(): string {
    if (codeSentNoticeFor !== undefined && sentEmail !== null) {
      return codeSentNoticeFor(sentEmail)
    }
    return codeSentNotice
  }

  const sentNotice = noticeText()

  const resendRow = (
    <div className="flex items-center justify-between">
      <ResendCodeButton cooldownSeconds={cooldown.remaining} onResend={resend} />
      <Button
        type="button"
        variant="ghost"
        className="h-auto p-0 text-muted-foreground"
        onClick={switchToEmailStep}
      >
        {differentEmailLabel}
      </Button>
    </div>
  )

  return { step, emailForm, codeForm, submitError, sentNotice, resendRow }
}

function EmailStepField({
  form
}: {
  readonly form: ReturnType<typeof useEmailCodeExchange>['emailForm']
}) {
  return (
    <form.Field name="email" validators={{ onChange: emailValidator }}>
      {(field) => (
        <FormTextField
          name={field.name}
          label={m.form_email()}
          type="email"
          placeholder={m.email_placeholder()}
          autoComplete="email"
          value={field.state.value}
          errors={field.state.meta.errors}
          onBlur={field.handleBlur}
          onChange={field.handleChange}
          required
        />
      )}
    </form.Field>
  )
}

function CodeStepFields({
  form,
  renderExtraFields
}: {
  readonly form: EmailCodeFormApi
  readonly renderExtraFields: ((form: EmailCodeFormApi) => ReactNode) | undefined
}) {
  return (
    <>
      <form.Field name="code" validators={{ onChange: sixDigitCodeValidator }}>
        {(field) => (
          <OtpCodeInput
            value={field.state.value}
            onChange={field.handleChange}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the code step has exactly one field group, so focusing its first cell cannot surprise anyone mid-task
            autoFocus
          />
        )}
      </form.Field>
      {renderExtraFields?.(form)}
    </>
  )
}

export function EmailCodeExchangePage(props: EmailCodeExchangeProps) {
  const {
    title,
    emailTitle = m.form_email_code(),
    emailDescription,
    emailFooter,
    codeSubmitLabel,
    codeSubmittingLabel,
    codeSubmitIcon,
    codeFooter,
    renderExtraFields
  } = props
  const exchange = useEmailCodeExchange(props)
  if (exchange.step === 'email') {
    return (
      <AuthCardForm
        title={emailTitle}
        description={emailDescription}
        form={exchange.emailForm}
        submit={
          <AuthSubmitButton
            form={exchange.emailForm}
            icon={<MailIcon className="size-4" />}
            label={emailTitle}
            submittingLabel={m.sending()}
          />
        }
        error={exchange.submitError}
        footer={emailFooter}
      >
        <EmailStepField form={exchange.emailForm} />
      </AuthCardForm>
    )
  }
  return (
    <AuthCardForm
      title={title}
      description={exchange.sentNotice}
      form={exchange.codeForm}
      submit={
        <AuthSubmitButton
          form={exchange.codeForm}
          icon={codeSubmitIcon ?? <ShieldCheckIcon className="size-4" />}
          label={codeSubmitLabel}
          submittingLabel={codeSubmittingLabel}
        />
      }
      error={exchange.submitError}
      footer={
        <div className="grid gap-3">
          {exchange.resendRow}
          {codeFooter}
        </div>
      }
    >
      <CodeStepFields form={exchange.codeForm} renderExtraFields={renderExtraFields} />
    </AuthCardForm>
  )
}

export function EmailCodeExchangeCard(props: EmailCodeExchangeProps) {
  const {
    title,
    emailTitle = m.form_email_code(),
    codeSubmitLabel,
    codeSubmittingLabel,
    codeSubmitIcon,
    renderExtraFields
  } = props
  const exchange = useEmailCodeExchange(props)
  const submit =
    exchange.step === 'email' ? (
      <AuthSubmitButton
        form={exchange.emailForm}
        icon={<MailIcon className="size-4" />}
        label={emailTitle}
        submittingLabel={m.sending()}
      />
    ) : (
      <AuthSubmitButton
        form={exchange.codeForm}
        icon={codeSubmitIcon ?? <ShieldCheckIcon className="size-4" />}
        label={codeSubmitLabel}
        submittingLabel={codeSubmittingLabel}
      />
    )
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void (exchange.step === 'email'
              ? exchange.emailForm.handleSubmit()
              : exchange.codeForm.handleSubmit())
          }}
          className="grid gap-4"
        >
          {exchange.step === 'email' ? (
            <EmailStepField form={exchange.emailForm} />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{exchange.sentNotice}</p>
              <CodeStepFields
                form={exchange.codeForm}
                renderExtraFields={renderExtraFields}
              />
              {exchange.resendRow}
            </>
          )}
          {submit}
          {exchange.submitError ? (
            <p role="alert" className="text-sm text-destructive">
              {exchange.submitError}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}
