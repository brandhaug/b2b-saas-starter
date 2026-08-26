import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { ShieldCheckIcon } from 'lucide-react'
import { AuthCardForm } from '@/components/auth/auth-card-form'
import {
  sixDigitCodeValidator,
  verifyTotpWithAuthClient,
  type VerifyTotpCode
} from '@/components/auth/auth-client-ports'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { FormTextField } from '@/components/form-text-field'
import { redirectSearch, safeRedirect } from '@/lib/utils'

export const Route = createFileRoute('/two-factor')({
  validateSearch: redirectSearch,
  component: TwoFactorRoute
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
  verifyTotp = verifyTotpWithAuthClient
}: {
  readonly redirect?: string | undefined
  readonly verifyTotp?: VerifyTotpCode
}) {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const result = await verifyTotp({ code: value.code })
      if (result.error) {
        setSubmitError(result.error.message ?? 'Verification failed')
        return
      }
      router.history.push(safeRedirect(redirect))
    }
  })

  return (
    <AuthCardForm
      title="Two-factor verification"
      description="Enter the six-digit code from your authenticator app to finish signing in."
      form={form}
      submit={
        <AuthSubmitButton
          form={form}
          icon={<ShieldCheckIcon className="size-4" />}
          label="Verify and sign in"
          submittingLabel="Verifying…"
        />
      }
      error={submitError}
    >
      <form.Field name="code" validators={{ onChange: sixDigitCodeValidator }}>
        {(field) => (
          <FormTextField
            name={field.name}
            label="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            required
          />
        )}
      </form.Field>
    </AuthCardForm>
  )
}
