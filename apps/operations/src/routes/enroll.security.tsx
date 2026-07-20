import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Field, SubmitButton } from '@/components/operations-ui.tsx'
import { formValue } from '@/lib/form-value.ts'
import {
  completeOperatorSecurityEnrollment,
  startOperatorSecurityEnrollment
} from '@/lib/server/operations.ts'

export const Route = createFileRoute('/enroll/security')({
  component: SecurityEnrollmentPage
})

function SecurityEnrollmentPage() {
  const [setup, setSetup] = useState<{
    readonly totpURI: string
    readonly backupCodes: readonly string[]
  } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-5">
      <section className="w-full max-w-lg border border-slate-200 bg-white p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
          No Operations permissions yet
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Secure your operator identity
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Confirm your password to configure TOTP and receive one-time backup codes.
        </p>
        {!setup ? (
          <form
            className="mt-6 grid gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              setMessage(null)
              void startOperatorSecurityEnrollment({
                data: { password: formValue(form, 'password') }
              }).then((result) => {
                if (result.state === 'ready') setSetup(result.data)
                else if (result.state === 'redirect')
                  window.location.assign(result.location)
                else setMessage(result.message)
              })
            }}
          >
            <Field label="Confirm password" name="password" type="password" required />
            <SubmitButton>Set up authenticator</SubmitButton>
          </form>
        ) : (
          <section className="mt-6">
            <h2 className="text-xl font-semibold">Confirm operator security</h2>
            <p className="mt-3 break-all rounded bg-slate-100 p-3 font-mono text-xs">
              {setup.totpURI}
            </p>
            <h3 className="mt-5 font-semibold">Backup codes</h3>
            <ul className="mt-2 grid grid-cols-2 gap-2">
              {setup.backupCodes.map((code) => (
                <li className="rounded bg-slate-100 p-2 font-mono text-xs" key={code}>
                  {code}
                </li>
              ))}
            </ul>
            <form
              className="mt-6 grid gap-5"
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                setMessage(null)
                void completeOperatorSecurityEnrollment({
                  data: {
                    code: formValue(form, 'code'),
                    backupCodesConfirmed: formValue(form, 'backupCodesConfirmed')
                  }
                }).then((result) => {
                  if (result.state === 'redirect')
                    window.location.assign(result.location)
                  else
                    setMessage(
                      'message' in result
                        ? result.message
                        : 'Security enrollment could not be completed.'
                    )
                })
              }}
            >
              <Field label="Authentication code" name="code" required />
              <label className="flex gap-2 text-sm">
                <input
                  name="backupCodesConfirmed"
                  required
                  type="checkbox"
                  value="yes"
                />
                I stored my backup codes
              </label>
              <SubmitButton>Complete enrollment</SubmitButton>
            </form>
          </section>
        )}
        {message ? (
          <p className="mt-5 rounded bg-red-50 p-3 text-sm text-red-800" role="alert">
            {message}
          </p>
        ) : null}
        <form action="/enroll/sign-out" className="mt-5" method="post">
          <button className="text-sm text-slate-600 underline" type="submit">
            Sign out of enrollment
          </button>
        </form>
      </section>
    </main>
  )
}
