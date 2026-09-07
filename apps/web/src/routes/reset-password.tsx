import { useState } from 'react'
import { pageTitle } from '@/components/page/page-title'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { KeyRoundIcon } from 'lucide-react'
import { AuthCardForm, AuthNoticeCard } from '@/components/auth/auth-card-form'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { passwordValidator } from '@/components/auth/auth-validators'
import { FormTextField } from '@/components/form-text-field'
import { authClient } from '@/lib/auth-client'
import { pickOptionalStrings } from '@/lib/utils'
import { authErrorCopy } from '@/lib/auth-error-copy'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search) => pickOptionalStrings(search, ['token', 'error']),
  component: ResetPasswordRoute,
  head: () => ({ meta: [{ title: pageTitle(m.public_meta_reset_password()) }] })
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
  error
}: {
  readonly token?: string | undefined
  readonly error?: string | undefined
}) {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { password: '', confirm: '' } satisfies ResetPasswordValues,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const result = await authClient.resetPassword({
        newPassword: value.password,
        token: token ?? ''
      })
      if (result.error) {
        setSubmitError(authErrorCopy(result.error, m.public_auth_reset_failed()))
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
      <AuthNoticeCard
        title={m.reset_link_unusable()}
        footer={
          <p className="text-center text-sm text-muted-foreground">
            <Link
              to="/forgot-password"
              className="text-primary underline underline-offset-4"
            >
              {m.request_new_reset_link()}
            </Link>
          </p>
        }
      >
        <p className="text-sm text-muted-foreground">{m.reset_link_invalid()}</p>
      </AuthNoticeCard>
    )
  }

  return (
    <AuthCardForm
      title={m.choose_new_password()}
      description={m.reset_sessions_description()}
      form={form}
      submit={
        <AuthSubmitButton
          form={form}
          icon={<KeyRoundIcon className="size-4" />}
          label={m.form_reset_password()}
          submittingLabel={m.resetting()}
        />
      }
      error={submitError}
    >
      <form.Field name="password" validators={{ onChange: passwordValidator }}>
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
      </form.Field>

      <form.Field
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
      </form.Field>
    </AuthCardForm>
  )
}
