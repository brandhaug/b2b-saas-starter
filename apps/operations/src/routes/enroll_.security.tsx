import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  AuthenticationShell,
  Feedback,
  Field,
  ScreenState,
  SubmitButton
} from '@/components/operations-ui.tsx'
import { formValue } from '@/lib/form-value.ts'
import {
  completeOperatorSecurityEnrollment,
  getOperatorEnrollment,
  startOperatorSecurityEnrollment
} from '@/lib/server/operations.ts'

export const Route = createFileRoute('/enroll_/security')({
  loader: () => getOperatorEnrollment(),
  component: SecurityEnrollmentPage
})

function SecurityEnrollmentPage() {
  const enrollment = Route.useLoaderData()
  const [setup, setSetup] = useState<{
    readonly totpURI: string
    readonly backupCodes: readonly string[]
  } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  if (enrollment.state !== 'ready')
    return (
      <AuthenticationShell
        eyebrow="Enrollment-only session"
        title="Enrollment unavailable"
      >
        <ScreenState result={enrollment} />
      </AuthenticationShell>
    )
  return (
    <AuthenticationShell
      description="Confirm your password to configure TOTP and receive one-time backup codes."
      eyebrow="No Operations permissions yet"
      title={`Secure ${enrollment.data.email}`}
    >
      {!setup ? (
        <form
          className="mt-6 grid gap-6"
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
          <p className="mt-4 break-all rounded-md bg-muted p-4 font-mono text-xs">
            {setup.totpURI}
          </p>
          <h3 className="mt-6 font-semibold">Backup codes</h3>
          <ul className="mt-2 grid grid-cols-2 gap-2">
            {setup.backupCodes.map((code) => (
              <li className="rounded-md bg-muted p-2 font-mono text-xs" key={code}>
                {code}
              </li>
            ))}
          </ul>
          <form
            className="mt-6 grid gap-6"
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
                if (result.state === 'redirect') window.location.assign(result.location)
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
              <input name="backupCodesConfirmed" required type="checkbox" value="yes" />
              I stored my backup codes
            </label>
            <SubmitButton>Complete enrollment</SubmitButton>
          </form>
        </section>
      )}
      {message ? <Feedback>{message}</Feedback> : null}
      <form action="/enroll/sign-out" className="mt-6" method="post">
        <button className="text-sm text-muted-foreground underline" type="submit">
          Sign out of enrollment
        </button>
      </form>
    </AuthenticationShell>
  )
}
