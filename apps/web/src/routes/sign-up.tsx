import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { Schema } from 'effect'
import { UserPlusIcon } from 'lucide-react'
import { FormTextField } from '@/components/form-text-field'
import { PublicLayout } from '@/components/public-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authClient } from '@/lib/auth-client'
import { useHydrated } from '@/lib/client-only-value'
import { safeRedirect } from '@/lib/utils'

const SignUpSearch = Schema.Struct({
  redirect: Schema.optional(Schema.String)
})

const decodeSearch = Schema.decodeUnknownSync(SignUpSearch)

export const Route = createFileRoute('/sign-up')({
  validateSearch: (search) => decodeSearch(search),
  component: SignUpRoute
})

type SignUpValues = {
  name: string
  email: string
  password: string
}

/**
 * Account registration, as a port. Injected rather than reaching for the
 * `authClient` singleton at the call site so a test drives the form with a
 * real function of this shape instead of replacing `@/lib/auth-client`.
 */
export type SignUpWithEmail = (input: {
  readonly name: string
  readonly email: string
  readonly password: string
}) => Promise<{ readonly error?: { readonly message?: string | undefined } | null }>

/**
 * The route's thin wrapper: reads the search param the router validated and
 * hands it to the page. Keeping the two apart is what lets the page be rendered
 * from a test with plain props, no route tree and no mocked router.
 */
function SignUpRoute() {
  const { redirect } = Route.useSearch()
  return <SignUpPage redirect={redirect} />
}

/**
 * Hoisted to module scope rather than written inline as a default: a new
 * function expression per render would be a fresh prop value every time.
 *
 * `callbackURL` is where Better Auth's verification redirect lands after the
 * emailed token is exchanged — the default ('/') would verify silently and
 * drop the user on the marketing homepage. Turnstile protection of this form
 * is a later wave; the seam is this one client call.
 */
function signUpWithAuthClient(
  input: Parameters<SignUpWithEmail>[0]
): ReturnType<SignUpWithEmail> {
  return authClient.signUp.email({
    name: input.name,
    email: input.email,
    password: input.password,
    callbackURL: `${window.location.origin}/verify-email`
  })
}

export function SignUpPage({
  redirect,
  signUp = signUpWithAuthClient
}: {
  readonly redirect?: string | undefined
  readonly signUp?: SignUpWithEmail
}) {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Hydration signal for e2e: interacting before React hydrates falls through
  // to a native GET submit, so a smoke test waits for this attribute.
  const hydrated = useHydrated()
  const form = useForm({
    defaultValues: { name: '', email: '', password: '' } satisfies SignUpValues,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const result = await signUp({
        name: value.name,
        email: value.email,
        password: value.password
      })
      if (result.error) {
        setSubmitError(result.error.message ?? 'Sign-up failed')
        return
      }
      // Registration signs the user in (auto sign-in) and emails a
      // verification link; the unverified banner on /workspaces carries the
      // rest of the story.
      router.history.push(safeRedirect(redirect))
    }
  })

  return (
    <PublicLayout>
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-md flex-1 place-items-center px-4 py-12"
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Create your account</CardTitle>
            <p className="text-sm text-muted-foreground">
              Sign up with email and password to run the starter on your own account. A
              verification email follows.
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
                    autoComplete="new-password"
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
                    <UserPlusIcon className="size-4" />
                    {isSubmitting ? 'Creating account…' : 'Create account'}
                  </Button>
                )}
              </form.Subscribe>

              {submitError ? (
                <p className="text-xs text-destructive" role="alert">
                  {submitError}
                </p>
              ) : null}
            </form>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link to="/sign-in" className="text-primary underline underline-offset-4">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    </PublicLayout>
  )
}
