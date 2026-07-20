import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Field, SubmitButton } from '@/components/operations-ui.tsx'
import { formValue } from '@/lib/form-value.ts'
import { acceptOperatorInvitation } from '@/lib/server/operations.ts'

export const Route = createFileRoute('/enroll')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : ''
  }),
  component: EnrollmentAcceptancePage
})

function EnrollmentAcceptancePage() {
  const { token } = Route.useSearch()
  const [message, setMessage] = useState<string | null>(null)
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-5">
      <section className="w-full max-w-lg border border-slate-200 bg-white p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
          Enrollment-only session
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Accept operator invitation
        </h1>
        {!token ? (
          <p
            className="mt-5 rounded bg-amber-50 p-3 text-sm text-amber-900"
            role="alert"
          >
            This invitation link is missing its single-use token.
          </p>
        ) : (
          <form
            className="mt-6 grid gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              setMessage(null)
              void acceptOperatorInvitation({
                data: {
                  token,
                  name: formValue(form, 'name'),
                  password: formValue(form, 'password')
                }
              }).then((result) => {
                if (result.state === 'redirect') window.location.assign(result.location)
                else
                  setMessage(
                    'message' in result
                      ? result.message
                      : 'The invitation could not be accepted.'
                  )
              })
            }}
          >
            <input name="token" type="hidden" value={token} />
            <Field label="Name" name="name" required />
            <Field
              label="Password (at least 12 characters)"
              name="password"
              type="password"
              required
            />
            <SubmitButton>Begin security enrollment</SubmitButton>
          </form>
        )}
        {message ? (
          <p className="mt-5 rounded bg-red-50 p-3 text-sm text-red-800" role="alert">
            {message}
          </p>
        ) : null}
      </section>
    </main>
  )
}
