import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AuthShell } from '@/components/auth-shell.tsx'
import { merchantAuthClient } from '@/lib/auth-client.ts'
import { formValue } from '@/lib/form-value.ts'

export const Route = createFileRoute('/sign-up')({ component: SignUpPage })

function SignUpPage() {
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <AuthShell title="Create your Merchant App account">
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          setPending(true)
          setMessage(null)
          void merchantAuthClient.signUp
            .email({
              name: formValue(form, 'name'),
              email: formValue(form, 'email'),
              password: formValue(form, 'password'),
              callbackURL: '/verify-email'
            })
            .then((result) => {
              if (result.error) {
                setMessage(
                  result.error.code === 'merchant_email_needs_configuration'
                    ? 'Email verification is not configured for this Merchant App yet.'
                    : 'We could not create that account. Try again or sign in.'
                )
                return
              }
              setMessage(
                'Check your verification email. In local development, use the link printed in the Merchant App server terminal.'
              )
            })
            .finally(() => setPending(false))
        }}
      >
        <label className="grid gap-1 text-sm">
          Name
          <input className="border bg-background px-3 py-2" name="name" required />
        </label>
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
            minLength={8}
            required
          />
        </label>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        <button
          className="bg-primary px-4 py-2 text-primary-foreground"
          disabled={pending}
        >
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <Link
        to="/sign-in"
        search={{ redirect: undefined }}
        className="mt-5 block text-sm text-foreground underline underline-offset-4 hover:text-muted-foreground"
      >
        Already have an account? Sign in
      </Link>
    </AuthShell>
  )
}
