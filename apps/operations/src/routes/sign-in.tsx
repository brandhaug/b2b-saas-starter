import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Field, SubmitButton } from '@/components/operations-ui.tsx'
import { formValue } from '@/lib/form-value.ts'
import { signInOperator } from '@/lib/server/operations.ts'

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === 'string' ? search.error : undefined,
    result: typeof search.result === 'string' ? search.result : undefined
  }),
  component: SignInPage
})

function SignInPage() {
  const search = Route.useSearch()
  const [message, setMessage] = useState<string | null>(null)
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-5">
      <section className="w-full max-w-md border border-slate-200 bg-white p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
          Dedicated auth realm
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Operations sign in
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Use your dedicated System Operator identity. Merchant credentials cannot enter
          this application.
        </p>
        {search.error || message ? (
          <p className="mt-5 rounded bg-red-50 p-3 text-sm text-red-800" role="alert">
            {message ?? 'Authentication was not accepted.'}
          </p>
        ) : null}
        {search.result === 'enrollment-complete' ? (
          <output className="mt-5 rounded bg-emerald-50 p-3 text-sm text-emerald-800">
            Security enrollment is complete. Sign in with your new credentials.
          </output>
        ) : null}
        <form
          className="mt-6 grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            setMessage(null)
            void signInOperator({
              data: {
                email: formValue(form, 'email'),
                password: formValue(form, 'password')
              }
            }).then((result) => {
              if (result.state === 'redirect') window.location.assign(result.location)
              else
                setMessage(
                  'message' in result
                    ? result.message
                    : 'Authentication was not accepted.'
                )
            })
          }}
        >
          <Field label="Email" name="email" type="email" required />
          <Field label="Password" name="password" type="password" required />
          <SubmitButton>Continue</SubmitButton>
        </form>
        <p className="mt-5 text-xs text-slate-500">
          Access is followed by a mandatory TOTP challenge. Invitation recipients should
          use the single-use link from their email.
        </p>
        <Link
          className="sr-only"
          search={{ merchantQuery: '', memberQuery: '' }}
          to="/"
        >
          Operations home
        </Link>
      </section>
    </main>
  )
}
