import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { Schema } from 'effect'
import { GitBranchIcon, KeyRoundIcon } from 'lucide-react'
import { FormTextField } from '@/components/form-text-field'
import { PublicLayout } from '@/components/public-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authClient } from '@/lib/auth-client'
import { useHydrated } from '@/lib/client-only-value'
import {
  DEMO_CREDENTIALS,
  DEMO_MEMBER_CREDENTIALS,
  DEMO_WORKSPACE_SLUG
} from '@/lib/demo-workspace'
import { safeRedirect } from '@/lib/utils'

const SignInSearch = Schema.Struct({
  redirect: Schema.optional(Schema.String)
})

const decodeSearch = Schema.decodeUnknownSync(SignInSearch)

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search) => decodeSearch(search),
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
}) => Promise<{ readonly error?: { readonly message?: string | undefined } | null }>

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
  // Hydration signal for e2e: interacting before React hydrates falls through
  // to a native GET submit, so the smoke test waits for this attribute.
  // `useHydrated` flips it after hydration with no effect-setState round trip,
  // so the first paint cannot flash the pre-hydration value.
  const hydrated = useHydrated()
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
      router.history.push(safeRedirect(redirect))
    }
  })

  return (
    <PublicLayout>
      {/* `flex-1` fills the space PublicLayout's `min-h-dvh flex-col` leaves
          between the header and its `mt-auto` footer — no hardcoded chrome height. */}
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-md flex-1 place-items-center px-4 py-12"
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <p className="text-sm text-muted-foreground">
              Sign in with email and password, or use GitHub when configured.
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
              <form.Field
                name="email"
                validators={{
                  onChange: ({ value }) => {
                    if (value.length === 0) return 'Email is required'
                    if (!value.includes('@')) return 'Enter a valid email'
                    return
                  }
                }}
              >
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

              <form.Field
                name="password"
                validators={{
                  onChange: ({ value }) =>
                    value.length < 8
                      ? 'Password must be at least 8 characters'
                      : undefined
                }}
              >
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

              <form.Subscribe
                selector={(state): readonly [boolean, boolean] => [
                  state.canSubmit,
                  state.isSubmitting
                ]}
              >
                {([canSubmit, isSubmitting]) => (
                  <Button type="submit" disabled={!canSubmit}>
                    <KeyRoundIcon className="size-4" />
                    {isSubmitting ? 'Signing in…' : 'Continue'}
                  </Button>
                )}
              </form.Subscribe>

              {submitError ? (
                <p className="text-xs text-destructive" role="alert">
                  {submitError}
                </p>
              ) : null}
            </form>
            <Button type="button" variant="outline" disabled>
              <GitBranchIcon className="size-4" />
              Continue with GitHub
            </Button>
            <p className="text-xs text-muted-foreground">
              Configure GitHub OAuth secrets to enable.
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
          </CardContent>
        </Card>
      </main>
    </PublicLayout>
  )
}
