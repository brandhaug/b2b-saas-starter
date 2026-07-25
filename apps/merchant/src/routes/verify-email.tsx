import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AuthShell } from '@/components/auth-shell.tsx'
import { merchantAuthClient } from '@/lib/auth-client.ts'
import { formValue } from '@/lib/form-value.ts'

export const Route = createFileRoute('/verify-email')({ component: VerifyEmailPage })

function VerifyEmailPage() {
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <AuthShell title="Verify your email">
      <p className="text-sm text-muted-foreground">
        Open the verification link we sent before signing in. In local development, the
        link is printed in the Merchant App server terminal.
      </p>
      <form
        className="mt-5 grid gap-4"
        action={async (form) => {
          setPending(true)
          setMessage(null)
          try {
            await merchantAuthClient.sendVerificationEmail({
              email: formValue(form, 'email'),
              callbackURL: '/verify-email'
            })
          } catch {
            // Keep the same response so this flow cannot reveal account ownership.
          } finally {
            setMessage('If that account needs verification, a link is on the way.')
            setPending(false)
          }
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
        <button type="submit" className="border px-4 py-2" disabled={pending}>
          {pending ? 'Sending…' : 'Resend verification link'}
        </button>
      </form>
      {message ? <p className="mt-4 text-sm text-muted-foreground">{message}</p> : null}
      <Link
        to="/sign-in"
        search={{ redirect: undefined }}
        className="mt-5 block text-sm text-foreground underline underline-offset-4 hover:text-muted-foreground"
      >
        Return to sign in
      </Link>
    </AuthShell>
  )
}
