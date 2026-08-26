import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { Schema } from 'effect'
import { KeyRoundIcon } from 'lucide-react'
import { AuthCardForm } from '@/components/auth/auth-card-form'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { emailValidator, passwordValidator } from '@/components/auth/auth-validators'
import { FormTextField } from '@/components/form-text-field'
import { authClient } from '@/lib/auth-client'
import {
  DEMO_CREDENTIALS,
  DEMO_MEMBER_CREDENTIALS,
  DEMO_WORKSPACE_SLUG
} from '@/lib/demo-workspace'
import { redirectSearch, safeRedirect } from '@/lib/utils'

export const Route = createFileRoute('/sign-in')({
  validateSearch: redirectSearch,
  component: SignInRoute
})

type SignInValues = {
  email: string
  password: string
}

/**
 * Credential sign-in, as a port. Injected rather than reaching for the
 * `authClient` singleton at the call site so a test drives the form with a real
 * function of this shape instead of replacing `@/lib/auth-client`.
 */
export type SignInWithEmail = (input: {
  readonly email: string
  readonly password: string
}) => Promise<{
  readonly error?: { readonly message?: string | undefined } | null
  // Opaque on purpose: Better Auth's client types don't expose the
  // two-factor marker, so the response body is decoded below rather than
  // asserted.
  readonly data?: unknown
}>

const SignInResponseData = Schema.Struct({
  twoFactorRedirect: Schema.optionalKey(Schema.Boolean)
})

const decodeSignInResponseData = Schema.decodeUnknownSync(SignInResponseData)

/**
 * The route's thin wrapper: reads the search param the router validated and
 * hands it to the page. Keeping the two apart is what lets the page be rendered
 * from a test with plain props, no route tree and no mocked router.
 */
function SignInRoute() {
  const { redirect } = Route.useSearch()
  return <SignInPage redirect={redirect} />
}

/**
 * Hoisted to module scope rather than written inline as a default: a new
 * function expression per render would be a fresh prop value every time.
 */
function signInWithAuthClient(
  input: Parameters<SignInWithEmail>[0]
): ReturnType<SignInWithEmail> {
  return authClient.signIn.email(input)
}

export function SignInPage({
  redirect,
  signIn = signInWithAuthClient
}: {
  readonly redirect?: string | undefined
  readonly signIn?: SignInWithEmail
}) {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { email: '', password: '' } satisfies SignInValues,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const result = await signIn({
        email: value.email,
        password: value.password
      })
      if (result.error) {
        setSubmitError(result.error.message ?? 'Sign-in failed')
        return
      }
      const twoFactorRedirect =
        result.data !== null &&
        result.data !== undefined &&
        decodeSignInResponseData(result.data).twoFactorRedirect === true
      if (twoFactorRedirect) {
        // Two-factor is enabled: the credentials set a short-lived challenge
        // cookie, not a session. The code lands on the challenge page, which
        // preserves the redirect target through its own search param.
        router.history.push(
          redirect
            ? `/two-factor?redirect=${encodeURIComponent(redirect)}`
            : '/two-factor'
        )
        return
      }
      router.history.push(safeRedirect(redirect))
    }
  })

  return (
    <AuthCardForm
      title="Sign in"
      description="Sign in with your email and password."
      form={form}
      submit={
        <AuthSubmitButton
          form={form}
          icon={<KeyRoundIcon className="size-4" />}
          label="Continue"
          submittingLabel="Signing in…"
        />
      }
      error={submitError}
      footer={
        <>
          <p className="text-right">
            <Link
              to="/forgot-password"
              search={{}}
              className="text-sm text-primary underline underline-offset-4"
            >
              Forgot your password?
            </Link>
          </p>
          <p className="text-xs text-muted-foreground">
            Seeded a local database? Sign in with{' '}
            <code className="rounded-sm bg-muted px-1 py-0.5">
              {DEMO_CREDENTIALS.email}
            </code>{' '}
            /{' '}
            <code className="rounded-sm bg-muted px-1 py-0.5">
              {DEMO_CREDENTIALS.password}
            </code>
            .
          </p>
          <p className="text-xs text-muted-foreground">
            Or as a plain member, to see the role-gated view:{' '}
            <code className="rounded-sm bg-muted px-1 py-0.5">
              {DEMO_MEMBER_CREDENTIALS.email}
            </code>{' '}
            /{' '}
            <code className="rounded-sm bg-muted px-1 py-0.5">
              {DEMO_MEMBER_CREDENTIALS.password}
            </code>
            .
          </p>
          <Link
            to="/workspaces/$workspaceSlug"
            params={{ workspaceSlug: DEMO_WORKSPACE_SLUG }}
            className="text-center text-sm text-primary underline underline-offset-4"
          >
            Open seeded workspace instead
          </Link>
          <p className="text-center text-sm text-muted-foreground">
            No account yet?{' '}
            <Link
              to="/sign-up"
              search={{}}
              className="text-primary underline underline-offset-4"
            >
              Create one
            </Link>
          </p>
        </>
      }
    >
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
            autoComplete="current-password"
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
