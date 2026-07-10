import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AuthShell } from '@/components/auth-shell.tsx'
import { merchantAuthClient } from '@/lib/auth-client.ts'
import { formValue } from '@/lib/form-value.ts'

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : undefined
  }),
  component: ResetPasswordPage
})

function ResetPasswordPage() {
  const { token } = Route.useSearch()
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <AuthShell title="Choose a new password">
      {token ? (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            setPending(true)
            void merchantAuthClient
              .resetPassword({ newPassword: formValue(form, 'password'), token })
              .then((result) => {
                setMessage(
                  result.error
                    ? 'This recovery link is invalid or has expired.'
                    : 'Your password has been reset. Sign in with your new password.'
                )
              })
              .finally(() => setPending(false))
          }}
        >
          <label className="grid gap-1 text-sm">
            New password
            <input
              className="border bg-background px-3 py-2"
              name="password"
              type="password"
              minLength={8}
              required
            />
          </label>
          <button
            className="bg-primary px-4 py-2 text-primary-foreground"
            disabled={pending}
          >
            {pending ? 'Resetting…' : 'Reset password'}
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          This recovery link is invalid or has expired.
        </p>
      )}
      {message ? <p className="mt-4 text-sm text-muted-foreground">{message}</p> : null}
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
