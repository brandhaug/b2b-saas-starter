import { useState } from 'react'
import { pageTitle } from '@/components/page/page-title'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { KeyRoundIcon } from 'lucide-react'
import { AuthCardForm } from '@/components/auth/auth-card-form'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { passwordValidator } from '@/components/auth/auth-validators'
import { FormTextField } from '@/components/form-text-field'
import {
  resetPasswordWithAuthClient,
  type ResetPassword
} from '@/components/auth/auth-client-ports'
import { pickOptionalStrings } from '@/lib/utils'

export type { ResetPassword } from '@/components/auth/auth-client-ports'

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search) => pickOptionalStrings(search, ['token', 'error']),
  component: ResetPasswordRoute,
  head: () => ({ meta: [{ title: pageTitle('Reset password') }] })
})

type ResetPasswordValues = {
  password: string
  confirm: string
}

/**
 * The route's thin wrapper: reads the search params the router validated and
 * hands them to the page. Keeping the two apart is what lets the page be
 * rendered from a test with plain props, no route tree and no mocked router.
 */
function ResetPasswordRoute() {
  const { token, error } = Route.useSearch()
  return <ResetPasswordPage token={token} error={error} />
}

export function ResetPasswordPage({
  token,
  error,
  resetPassword = resetPasswordWithAuthClient
}: {
  readonly token?: string | undefined
  readonly error?: string | undefined
  readonly resetPassword?: ResetPassword
}) {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { password: '', confirm: '' } satisfies ResetPasswordValues,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const result = await resetPassword({
        newPassword: value.password,
        token: token ?? ''
      })
      if (result.error) {
        setSubmitError(result.error.message ?? 'Reset failed')
        return
      }
      // The reset revokes every session (revokeSessionsOnPasswordReset), so
      // the only honest next step is a fresh sign-in.
      router.history.push('/sign-in')
    }
  })

  // No token, or the token-exchange hop already rejected it: one opaque
  // state for every failure, same rule as the invitation accept page.
  if (!token || error) {
    return (
      <AuthCardForm
        title="This link cannot be used"
        form={null}
        footer={
          <p className="text-center text-sm text-muted-foreground">
            <Link
              to="/forgot-password"
              className="text-primary underline underline-offset-4"
            >
              Request a new reset link
            </Link>
          </p>
        }
      >
        <p className="text-sm text-muted-foreground">
          The password reset link is invalid or has expired. Links work once and expire
          after thirty minutes.
        </p>
      </AuthCardForm>
    )
  }

  return (
    <AuthCardForm
      title="Choose a new password"
      description="Every session signed in before this reset will be signed out."
      form={form}
      submit={
        <AuthSubmitButton
          form={form}
          icon={<KeyRoundIcon className="size-4" />}
          label="Reset password"
          submittingLabel="Resetting…"
        />
      }
      error={submitError}
    >
      <form.Field name="password" validators={{ onChange: passwordValidator }}>
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
      </form.Field>

      <form.Field
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
      </form.Field>
    </AuthCardForm>
  )
}
