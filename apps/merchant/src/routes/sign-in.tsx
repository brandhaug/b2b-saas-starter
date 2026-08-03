import { useRef, useState } from 'react'
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
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const prefillSeededAccount = () => {
    const form = formRef.current
    if (!form) return

    const email = form.elements.namedItem('email')
    const password = form.elements.namedItem('password')
    if (email instanceof HTMLInputElement) {
      email.value = 'merchant@booking.local'
      email.focus()
    }
    if (password instanceof HTMLInputElement)
      password.value = 'merchant-booking-password'
  }

  return (
    <AuthShell title="Sign in to your Merchant App">
      <form
        ref={formRef}
        className="grid gap-4"
        action={async (form) => {
          setPending(true)
          setError(null)
          try {
            const result = await merchantAuthClient.signIn.email({
              email: formValue(form, 'email'),
              password: formValue(form, 'password'),
              callbackURL: safeMerchantReturnPath(redirect)
            })
            if (result.error) {
              setError('Unable to sign in with those credentials.')
              return
            }
            await router.navigate({
              href: safeMerchantReturnPath(redirect),
              replace: true
            })
          } catch {
            setError('Sign in is temporarily unavailable. Please try again.')
          } finally {
            setPending(false)
          }
        }}
      >
        {import.meta.env.DEV ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed bg-muted/40 p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Development
              </p>
              <p className="mt-0.5 text-sm">Seeded merchant account</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
              onClick={prefillSeededAccount}
            >
              Prefill
            </button>
          </div>
        ) : null}
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
          type="submit"
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
