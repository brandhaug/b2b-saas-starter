import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Field, SubmitButton } from '@/components/operations-ui.tsx'
import { formValue } from '@/lib/form-value.ts'
import { verifyOperatorTotp } from '@/lib/server/operations.ts'

export const Route = createFileRoute('/verify-totp')({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === 'string' ? search.error : undefined
  }),
  component: VerifyTotpPage
})

function VerifyTotpPage() {
  const { error } = Route.useSearch()
  const [message, setMessage] = useState<string | null>(null)
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-5">
      <section className="w-full max-w-md border border-slate-200 bg-white p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
          Mandatory second factor
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Verify your presence
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          Enter the current six-digit code from your authenticator.
        </p>
        {error || message ? (
          <p className="mt-5 rounded bg-red-50 p-3 text-sm text-red-800" role="alert">
            {message ?? 'That authentication code was not accepted.'}
          </p>
        ) : null}
        <form
          className="mt-6 grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            setMessage(null)
            void verifyOperatorTotp({ data: { code: formValue(form, 'code') } }).then(
              (result) => {
                if (result.state === 'redirect') window.location.assign(result.location)
                else
                  setMessage(
                    'message' in result
                      ? result.message
                      : 'That authentication code was not accepted.'
                  )
              }
            )
          }}
        >
          <Field label="Authentication code" name="code" required />
          <SubmitButton>Verify and continue</SubmitButton>
        </form>
      </section>
    </main>
  )
}
