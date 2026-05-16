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

const SignInSearch = Schema.Struct({
  redirect: Schema.optional(Schema.String)
})

const decodeSearch = Schema.decodeUnknownSync(SignInSearch)

// Only allow same-origin path redirects to prevent open redirects.
const safeRedirect = (raw: string | undefined): string =>
  raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/workspaces'

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search) => decodeSearch(search),
  component: SignInPage
})

type SignInValues = {
  email: string
  password: string
}

function SignInPage() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { email: '', password: '' } satisfies SignInValues,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const result = await authClient.signIn.email({
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
      <main
        id="main-content"
        className="mx-auto grid min-h-[calc(100dvh-8rem)] w-full max-w-md place-items-center px-4 py-12"
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
                    return undefined
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
                selector={(state) => [state.canSubmit, state.isSubmitting] as const}
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
            <Link
              to="/workspaces/$workspaceSlug"
              params={{ workspaceSlug: 'starter-lab' }}
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
