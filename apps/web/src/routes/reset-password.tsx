import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { Schema } from 'effect'
import { KeyRoundIcon } from 'lucide-react'
import { AuthCardForm } from '@/components/auth/auth-card-form'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { passwordValidator } from '@/components/auth/auth-validators'
import { FormTextField } from '@/components/form-text-field'
import { authClient } from '@/lib/auth-client'

const ResetPasswordSearch = Schema.Struct({
  token: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String)
})

const decodeSearch = Schema.decodeUnknownSync(ResetPasswordSearch)

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search) => decodeSearch(search),
  component: ResetPasswordRoute
})

type ResetPasswordValues = {
  password: string
  confirm: string
}

/**
 * Setting the new password, as a port. Injected rather than reaching for the
 * `authClient` singleton at the call site so a test drives the form with a
 * real function of this shape instead of replacing `@/lib/auth-client`.
 */
export type ResetPassword = (input: {
  readonly newPassword: string
  readonly token: string
}) => Promise<{ readonly error?: { readonly message?: string | undefined } | null }>

/**
 * The route's thin wrapper: reads the search params the router validated and
 * hands them to the page. Keeping the two apart is what lets the page be
 * rendered from a test with plain props, no route tree and no mocked router.
 */
function ResetPasswordRoute() {
  const { token, error } = Route.useSearch()
  return <ResetPasswordPage token={token} error={error} />
}

/**
 * Hoisted to module scope rather than written inline as a default: a new
 * function expression per render would be a fresh prop value every time.
 */
function resetPasswordWithAuthClient(
  input: Parameters<ResetPassword>[0]
): ReturnType<ResetPassword> {
  return authClient.resetPassword({
    newPassword: input.newPassword,
    token: input.token
  })
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
      if (value.password !== value.confirm) {
        setSubmitError('Passwords do not match')
        return
      }
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
          after an hour.
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
          onChange: ({ value }) =>
            value.length === 0 ? 'Confirm your password' : undefined
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
