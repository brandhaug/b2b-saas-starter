import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { AuthShell } from '@/components/auth-shell.tsx'
import { merchantAuthClient } from '@/lib/auth-client.ts'
import { formValue } from '@/lib/form-value.ts'
import { safeMerchantReturnPath } from '@/lib/safe-return-path.ts'

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined
  }),
  component: SignInPage
})

function SignInPage() {
  const router = useRouter()
  const { redirect } = Route.useSearch()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <AuthShell title="Sign in to your Merchant App">
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          setPending(true)
          setError(null)
          void merchantAuthClient.signIn
            .email({
              email: formValue(form, 'email'),
              password: formValue(form, 'password'),
              callbackURL: safeMerchantReturnPath(redirect)
            })
            .then((result) => {
              if (result.error) {
                setError('Unable to sign in with those credentials.')
                return
              }
              void router.navigate({
                href: safeMerchantReturnPath(redirect),
                replace: true
              })
            })
            .finally(() => setPending(false))
        }}
      >
        <label className="grid gap-1 text-sm">
          Email
          <input
            className="border bg-background px-3 py-2"
            name="email"
            type="email"
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          Password
          <input
            className="border bg-background px-3 py-2"
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={8}
            required
          />
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button
          className="bg-primary px-4 py-2 text-primary-foreground"
          disabled={pending}
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="mt-5 flex justify-between text-sm text-foreground underline underline-offset-4 [&_a:hover]:text-muted-foreground">
        <Link to="/sign-up">Create an account</Link>
        <Link to="/forgot-password">Forgot password?</Link>
      </div>
    </AuthShell>
  )
}
