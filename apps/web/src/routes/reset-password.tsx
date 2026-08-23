import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { Schema } from 'effect'
import { KeyRoundIcon } from 'lucide-react'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { passwordValidator } from '@/components/auth/auth-validators'
import { FormTextField } from '@/components/form-text-field'
import { PublicLayout } from '@/components/public-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authClient } from '@/lib/auth-client'
import { useHydrated } from '@/lib/client-only-value'

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
  const hydrated = useHydrated()
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
      <PublicLayout>
        <main
          id="main-content"
          className="mx-auto grid w-full max-w-md flex-1 place-items-center px-4 py-12"
        >
          <Card className="w-full">
            <CardHeader>
              <CardTitle>This link cannot be used</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                The password reset link is invalid or has expired. Links work once and
                expire after an hour.
              </p>
              <p className="text-center text-sm text-muted-foreground">
                <Link
                  to="/forgot-password"
                  className="text-primary underline underline-offset-4"
                >
                  Request a new reset link
                </Link>
              </p>
            </CardContent>
          </Card>
        </main>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout>
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-md flex-1 place-items-center px-4 py-12"
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Choose a new password</CardTitle>
            <p className="text-sm text-muted-foreground">
              Every session signed in before this reset will be signed out.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form
              data-hydrated={hydrated ? 'true' : undefined}
              onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void form.handleSubmit()
              }}
              className="grid gap-4"
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

              <AuthSubmitButton
                form={form}
                icon={<KeyRoundIcon className="size-4" />}
                label="Reset password"
                submittingLabel="Resetting…"
              />

              {submitError ? (
                <p className="text-xs text-destructive" role="alert">
                  {submitError}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </main>
    </PublicLayout>
  )
}
