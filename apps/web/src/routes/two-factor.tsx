import { useState } from 'react'
import { pageTitle } from '@/components/page/page-title'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { ShieldCheckIcon } from 'lucide-react'
import { AuthCardForm } from '@/components/auth/auth-card-form'
import {
  backupCodeValidator,
  sixDigitCodeValidator,
  verifyBackupCodeWithAuthClient,
  verifyTotpWithAuthClient,
  type VerifyBackupCode,
  type VerifyTotpCode
} from '@/components/auth/auth-client-ports'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { oauthContinuationUrl } from '@/lib/oauth-continuation'
import { FormTextField } from '@/components/form-text-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { type AuthResult } from '@/lib/auth-result'
import { authErrorCopy } from '@/lib/auth-error-copy'
import { redirectSearch, safeRedirect } from '@/lib/utils'

export const Route = createFileRoute('/two-factor')({
  validateSearch: redirectSearch,
  component: TwoFactorRoute,
  head: () => ({ meta: [{ title: pageTitle('Two-factor verification') }] })
})

function TwoFactorRoute() {
  const { redirect } = Route.useSearch()
  return <TwoFactorChallengePage redirect={redirect} />
}

/**
 * The second half of a two-factor sign-in. The credentials step set Better
 * Auth's short-lived two-factor cookie — there is no session yet, and this is
 * the only thing that turns the challenge into one.
 */
export function TwoFactorChallengePage({
  redirect,
  verifyTotp = verifyTotpWithAuthClient,
  verifyBackupCode = verifyBackupCodeWithAuthClient
}: {
  readonly redirect?: string | undefined
  readonly verifyTotp?: VerifyTotpCode
  readonly verifyBackupCode?: VerifyBackupCode
}) {
  const router = useRouter()
  // The authenticator code is the default; the backup code is the escape
  // hatch for the lost device. Mode is UI state, not a route, so switching
  // keeps the redirect target (and any OAuth continuation) it arrived with.
  const [method, setMethod] = useState<'totp' | 'backup'>('totp')
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Unchecked by default: trusting a device skips this challenge for thirty
  // days, so it is an explicit opt-in every time, never a remembered one.
  const [trustDevice, setTrustDevice] = useState(false)

  /**
   * The one outcome ladder both methods share: a challenge that completes an
   * MCP client's authorization is answered with that flow's next URL (which
   * may be another origin — a full navigation); every other success continues
   * to the redirect target, `/workspaces` by way of `safeRedirect`.
   */
  function finishChallenge(result: AuthResult): void {
    if (result.error) {
      setSubmitError(authErrorCopy(result.error, 'Verification failed'))
      return
    }
    const continuation = oauthContinuationUrl(result.data)
    if (continuation !== null) {
      window.location.assign(continuation)
      return
    }
    router.history.push(safeRedirect(redirect))
  }

  const totpForm = useForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      finishChallenge(await verifyTotp({ code: value.code, trustDevice }))
    }
  })

  const backupForm = useForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      finishChallenge(await verifyBackupCode({ code: value.code.trim(), trustDevice }))
    }
  })

  // Both methods trust the same device cookie, so the control renders once
  // and rides whichever form is showing — the label association survives the
  // swap because the id is stable.
  const trustControl = (
    <div className="flex items-center gap-2">
      <Checkbox
        id="trust-device"
        checked={trustDevice}
        onCheckedChange={setTrustDevice}
      />
      <Label htmlFor="trust-device">Trust this device for 30 days</Label>
    </div>
  )

  // The method switch rides the card footer, after the point of action, like
  // sign-in's password/link modes. Switching clears the error: it belonged to
  // the form being left.
  const methodToggle = (
    <Button
      type="button"
      variant="link"
      onClick={() => {
        setSubmitError(null)
        setMethod(method === 'totp' ? 'backup' : 'totp')
      }}
      className="justify-start p-0 text-sm"
    >
      {method === 'totp' ? 'Use a backup code' : 'Use an authenticator code instead'}
    </Button>
  )

  if (method === 'backup') {
    return (
      <AuthCardForm
        title="Two-factor verification"
        description="Enter one of the ten codes you saved when you set up two-factor authentication. Each code works once."
        form={backupForm}
        submit={
          <AuthSubmitButton
            form={backupForm}
            icon={<ShieldCheckIcon className="size-4" />}
            label="Verify and sign in"
            submittingLabel="Verifying…"
          />
        }
        error={submitError}
        footer={methodToggle}
      >
        <backupForm.Field name="code" validators={{ onChange: backupCodeValidator }}>
          {(field) => (
            <FormTextField
              name={field.name}
              label="Backup code"
              autoComplete="off"
              placeholder="aB3dE-f9gH1"
              maxLength={11}
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the challenge page has exactly one field, so focusing it cannot surprise anyone mid-task
              autoFocus
              value={field.state.value}
              errors={field.state.meta.errors}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              required
            />
          )}
        </backupForm.Field>
        {trustControl}
      </AuthCardForm>
    )
  }

  return (
    <AuthCardForm
      title="Two-factor verification"
      description="Enter the six-digit code from your authenticator app to finish signing in."
      form={totpForm}
      submit={
        <AuthSubmitButton
          form={totpForm}
          icon={<ShieldCheckIcon className="size-4" />}
          label="Verify and sign in"
          submittingLabel="Verifying…"
        />
      }
      error={submitError}
      footer={methodToggle}
    >
      <totpForm.Field name="code" validators={{ onChange: sixDigitCodeValidator }}>
        {(field) => (
          <FormTextField
            name={field.name}
            label="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the challenge page has exactly one field, so focusing it cannot surprise anyone mid-task
            autoFocus
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={(value) => field.handleChange(value.replaceAll(/\D/g, ''))}
            required
          />
        )}
      </totpForm.Field>
      {trustControl}
    </AuthCardForm>
  )
}
