import { useState } from 'react'
import { pageTitle } from '@/components/page/page-title'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { UserPlusIcon } from 'lucide-react'
import { AuthCardForm } from '@/components/auth/auth-card-form'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { emailValidator, passwordValidator } from '@/components/auth/auth-validators'
import { FormTextField } from '@/components/form-text-field'
import {
  signUpWithAuthClient,
  type SignUpWithEmail
} from '@/components/auth/auth-client-ports'
import { getTurnstileSiteKey } from '@/lib/server/turnstile'
import { redirectSearch, safeRedirect } from '@/lib/utils'
import { TurnstileWidget } from '@/components/auth/turnstile-widget'

export type { SignUpWithEmail } from '@/components/auth/auth-client-ports'

export const Route = createFileRoute('/sign-up')({
  validateSearch: redirectSearch,
  // The site key is read on the server only; `null` keeps the widget unmounted.
  loader: async () => ({ turnstileSiteKey: await getTurnstileSiteKey() }),
  component: SignUpRoute,
  head: () => ({ meta: [{ title: pageTitle('Create your account') }] })
})

type SignUpValues = {
  name: string
  email: string
  password: string
}

/**
 * The route's thin wrapper: reads the search param the router validated and
 * the loader's Turnstile site key, then hands both to the page. Keeping the
 * two apart is what lets the page be rendered from a test with plain props,
 * no route tree and no mocked router.
 */
function SignUpRoute() {
  const { redirect } = Route.useSearch()
  const { turnstileSiteKey } = Route.useLoaderData()
  return <SignUpPage redirect={redirect} turnstileSiteKey={turnstileSiteKey} />
}

export function SignUpPage({
  redirect,
  signUp = signUpWithAuthClient,
  turnstileSiteKey = null
}: {
  readonly redirect?: string | undefined
  readonly signUp?: SignUpWithEmail
  /** Server-provided Turnstile site key; `null` renders no widget (provider-light). */
  readonly turnstileSiteKey?: string | null | undefined
}) {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)
  // The challenge token; single-use, so a failed sign-up clears it and the
  // visitor answers a fresh challenge on retry.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { name: '', email: '', password: '' } satisfies SignUpValues,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      if (turnstileSiteKey !== null && turnstileToken === null) {
        setSubmitError('Complete the bot check before creating your account.')
        return
      }
      const result = await signUp({
        name: value.name,
        email: value.email,
        password: value.password,
        turnstileToken: turnstileToken ?? undefined
      })
      if (result.error) {
        setTurnstileToken(null)
        setSubmitError(
          result.error.message?.includes('captcha') === true
            ? 'The bot check failed — try the challenge again.'
            : (result.error.message ?? 'Sign-up failed')
        )
        return
      }
      // Registration signs the user in (auto sign-in) and emails a
      // verification link; the unverified banner on /workspaces carries the
      // rest of the story.
      router.history.push(safeRedirect(redirect))
    }
  })

  return (
    <AuthCardForm
      title="Create your account"
      description="Sign up with email and password to run the starter on your own account. A verification email follows."
      form={form}
      submit={
        <AuthSubmitButton
          form={form}
          icon={<UserPlusIcon className="size-4" />}
          label="Create account"
          submittingLabel="Creating account…"
        />
      }
      error={submitError}
      footer={
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/sign-in" className="text-primary underline underline-offset-4">
            Sign in
          </Link>
        </p>
      }
    >
      <form.Field
        name="name"
        validators={{
          onChange: ({ value }) =>
            value.trim().length === 0 ? 'Name is required' : undefined
        }}
      >
        {(field) => (
          <FormTextField
            name={field.name}
            label="Name"
            type="text"
            placeholder="Ada Lovelace"
            autoComplete="name"
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            required
          />
        )}
      </form.Field>

      <form.Field name="email" validators={{ onChange: emailValidator }}>
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
      </form.Field>

      <form.Field name="password" validators={{ onChange: passwordValidator }}>
        {(field) => (
          <FormTextField
            name={field.name}
            label="Password"
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

      {turnstileSiteKey === null ? null : (
        <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} />
      )}
    </AuthCardForm>
  )
}
