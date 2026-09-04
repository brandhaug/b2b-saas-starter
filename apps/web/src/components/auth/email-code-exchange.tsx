import { useState, type ReactNode } from 'react'
import {
  useForm,
  type FormAsyncValidateOrFn,
  type FormValidateOrFn,
  type ReactFormExtendedApi
} from '@tanstack/react-form'
import { MailIcon, ShieldCheckIcon } from 'lucide-react'
import {
  sendEmailCodeWithAuthClient,
  sixDigitCodeValidator,
  type EmailCodePurpose,
  type SendEmailCode
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
import { type AuthResult } from '@/lib/auth-result'

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
 * cooldown, the "use a different email" reset, and the
 * `result.error.message ?? fallback` folding — so the routes only supply the
 * ports and the copy.
 *
 * `layout` picks the chrome: `"page"` renders both steps as standalone
 * `AuthCardForm`s (title + description per step, the footer slots); `"card"`
 * renders one `Card` with a single heading for embedding in a page that
 * already has a layout, with the resend row inside the form like the
 * verify-email page always showed it.
 *
 * `email` presets the address (the reset flow collects it in its fused
 * request form, so its exchange starts on the code step); without it the
 * flow starts on the email step.
 */
export function EmailCodeExchange({
  purpose,
  send = sendEmailCodeWithAuthClient,
  verify,
  onVerified,
  layout = 'page',
  email,
  title,
  emailTitle = 'Email me a code',
  emailDescription,
  emailFooter,
  codeSentNotice,
  codeSentNoticeFor,
  codeSubmitLabel,
  codeSubmittingLabel,
  codeSubmitIcon,
  codeFooter,
  verifyErrorFallback = 'Verification failed',
  renderExtraFields,
  differentEmailLabel = 'Use a different email',
  onDifferentEmail
}: {
  readonly purpose: EmailCodePurpose
  readonly send?: SendEmailCode
  readonly verify: VerifyEmailCode
  readonly onVerified: () => void
  readonly layout?: 'page' | 'card'
  /** A code was already sent here — start on the code step. */
  readonly email?: string
  /** The code step's heading (the card's only heading in `card` layout). */
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
  /** Rendered under the resend row in the card footer (`page` layout). */
  readonly codeFooter?: ReactNode
  readonly verifyErrorFallback?: string
  /** Extra fields between the code input and the submit button (the reset
   * flow's password pair), rendered against the shared code form. */
  readonly renderExtraFields?: (form: EmailCodeFormApi) => ReactNode
  readonly differentEmailLabel?: string
  /** Overrides the built-in return to the email step (the reset flow goes
   * back to its fused request form instead). */
  readonly onDifferentEmail?: () => void
}) {
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
        setSubmitError(result.error.message ?? 'Could not send the code')
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
        setSubmitError(result.error.message ?? verifyErrorFallback)
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
      setSubmitError(result.error.message ?? 'Could not resend the code')
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

  if (step === 'email') {
    if (layout === 'card') {
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
                label={emailTitle}
                submittingLabel="Sending…"
              />
              {submitError ? (
                <p role="alert" className="text-sm text-destructive">
                  {submitError}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      )
    }
    return (
      <AuthCardForm
        title={emailTitle}
        description={emailDescription}
        form={emailForm}
        submit={
          <AuthSubmitButton
            form={emailForm}
            icon={<MailIcon className="size-4" />}
            label={emailTitle}
            submittingLabel="Sending…"
          />
        }
        error={submitError}
        footer={emailFooter}
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

  const codeField = (
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
  )

  if (layout === 'card') {
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
              void codeForm.handleSubmit()
            }}
            className="grid gap-4"
          >
            <p className="text-sm text-muted-foreground">{sentNotice}</p>
            {codeField}
            {renderExtraFields?.(codeForm)}
            {resendRow}
            <AuthSubmitButton
              form={codeForm}
              icon={codeSubmitIcon ?? <ShieldCheckIcon className="size-4" />}
              label={codeSubmitLabel}
              submittingLabel={codeSubmittingLabel}
            />
            {submitError ? (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    )
  }

  return (
    <AuthCardForm
      title={title}
      description={sentNotice}
      form={codeForm}
      submit={
        <AuthSubmitButton
          form={codeForm}
          icon={codeSubmitIcon ?? <ShieldCheckIcon className="size-4" />}
          label={codeSubmitLabel}
          submittingLabel={codeSubmittingLabel}
        />
      }
      error={submitError}
      footer={
        <div className="grid gap-3">
          {resendRow}
          {codeFooter}
        </div>
      }
    >
      {codeField}
      {renderExtraFields?.(codeForm)}
    </AuthCardForm>
  )
}
