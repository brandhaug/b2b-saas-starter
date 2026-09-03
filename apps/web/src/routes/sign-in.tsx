import { useState } from 'react'
import { pageTitle } from '@/components/page/page-title'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { KeyRoundIcon } from 'lucide-react'
import { AuthCardForm } from '@/components/auth/auth-card-form'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { emailValidator, passwordValidator } from '@/components/auth/auth-validators'
import { FormTextField } from '@/components/form-text-field'
import {
  signInWithAuthClient,
  signInWithSsoAuthClient,
  type SignInWithEmail,
  type SignInWithSso
} from '@/components/auth/auth-client-ports'
import {
  DEMO_CREDENTIALS,
  DEMO_MEMBER_CREDENTIALS,
  DEMO_WORKSPACE_SLUG
} from '@/lib/demo-workspace'
import { resolveSsoRoutingServerFn } from '@/lib/server/workspace-sso'
import { redirectSearch, safeRedirect } from '@/lib/utils'

export type {
  SignInWithEmail,
  SignInWithSso
} from '@/components/auth/auth-client-ports'

/** The domain-routing ask, as a port so a test drives the page without a server. */
export type ResolveSsoRouting = (email: string) => Promise<{
  readonly requireSso: boolean
} | null>

async function resolveSsoRouting(email: string) {
  // A failed ask must not dead-end the form: the password path is the
  // fallback, exactly as it was before SSO existed.
  const decision = await resolveSsoRoutingServerFn({ data: { email } }).catch(
    () => null
  )
  return decision
}

export const Route = createFileRoute('/sign-in')({
  validateSearch: redirectSearch,
  component: SignInRoute,
  head: () => ({ meta: [{ title: pageTitle('Sign in') }] })
})

type SignInValues = {
  email: string
  password: string
}

/**
 * Whether the sign-in response asks for the two-factor hop. A plain field
 * probe rather than an effect Schema: this route is statically imported by the
 * route tree and ships to the browser, so it must not pin the Effect runtime.
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- Better Auth's response `data` is untyped JSON at this boundary; this probe is the parse step
function wantsTwoFactorRedirect(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'twoFactorRedirect' in data &&
    data.twoFactorRedirect === true
  )
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof

/**
 * Whether a failed credential sign-in was refused by the require-SSO gate.
 * Same probe discipline: the client's error is untyped JSON at this boundary.
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- Better Auth's client `error` is untyped JSON at this boundary; this probe is the parse step
function wasRefusedForSso(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'sso_required'
  )
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof

/**
 * The route's thin wrapper: reads the search param the router validated and
 * hands it to the page. Keeping the two apart is what lets the page be rendered
 * from a test with plain props, no route tree and no mocked router.
 */
function SignInRoute() {
  const { redirect } = Route.useSearch()
  return <SignInPage redirect={redirect} />
}

export function SignInPage({
  redirect,
  signIn = signInWithAuthClient,
  signInWithSso = signInWithSsoAuthClient,
  resolveRouting = resolveSsoRouting
}: {
  readonly redirect?: string | undefined
  readonly signIn?: SignInWithEmail
  readonly signInWithSso?: SignInWithSso
  readonly resolveRouting?: ResolveSsoRouting
}) {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [ssoNotice, setSsoNotice] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { email: '', password: '' } satisfies SignInValues,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      setSsoNotice(null)
      // Domain routing first (ADR 0055): an email whose domain belongs to an
      // enabled connection goes to that IdP — the password path is never even
      // attempted. `requireSso` domains are additionally refused server-side,
      // so a direct POST cannot sidestep the rule.
      const routing = await resolveRouting(value.email)
      if (routing !== null) {
        const sso = await signInWithSso({
          email: value.email,
          callbackURL: safeRedirect(redirect)
        })
        if (sso.error) {
          setSubmitError(sso.error.message ?? 'Single sign-in failed')
          return
        }
        if (sso.data?.url) {
          window.location.assign(sso.data.url)
          return
        }
      }
      const result = await signIn({
        email: value.email,
        password: value.password
      })
      if (result.error) {
        // The server-side gate answers a require-SSO domain with this code;
        // surface it as guidance rather than a bare failed sign-in.
        if (wasRefusedForSso(result.error)) {
          setSsoNotice(
            'This workspace requires single sign-on for your email domain. Sign in with your identity provider.'
          )
          return
        }
        setSubmitError(result.error.message ?? 'Sign-in failed')
        return
      }
      const twoFactorRedirect =
        result.data !== null &&
        result.data !== undefined &&
        wantsTwoFactorRedirect(result.data)
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
      notice={ssoNotice}
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
          {/* The seed workspace is the public reference app — the hero CTA
              lands behind sign-in, so the credentials stay on the page in
              production too (they exist only after seeding a local D1). */}
          <p className="text-xs text-muted-foreground">
            Seeded the local database? Sign in with{' '}
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
