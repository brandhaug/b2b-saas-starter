import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AuthShell } from '@/components/auth-shell.tsx'
import { merchantAuthClient } from '@/lib/auth-client.ts'
import { formValue } from '@/lib/form-value.ts'

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage
})

function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)

  return (
    <AuthShell title="Reset your password">
      <p className="mb-5 text-sm text-muted-foreground">
        Enter your email and we will send recovery instructions if an account can use
        it.
      </p>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          setPending(true)
          void merchantAuthClient
            .requestPasswordReset({
              email: formValue(form, 'email'),
              redirectTo: `${window.location.origin}/reset-password`
            })
            .finally(() => {
              // This message stays identical regardless of whether the account
              // exists, preventing recovery from disclosing account ownership.
              setSubmitted(true)
              setPending(false)
            })
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
        <button
          className="bg-primary px-4 py-2 text-primary-foreground"
          disabled={pending}
        >
          {pending ? 'Sending…' : 'Send recovery instructions'}
        </button>
      </form>
      {submitted ? (
        <p className="mt-4 text-sm text-muted-foreground">
          If that email can recover a Merchant App account, recovery instructions are on
          the way. In local development, use the link printed in the server terminal.
        </p>
      ) : null}
      <Link
        to="/sign-in"
        search={{ redirect: undefined }}
        className="mt-5 block text-sm text-primary underline underline-offset-4"
      >
        Return to sign in
      </Link>
    </AuthShell>
  )
}
