import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  AuthenticationShell,
  Feedback,
  Field,
  SubmitButton
} from '@/components/operations-ui.tsx'
import { formValue } from '@/lib/form-value.ts'
import { acceptOperatorInvitation } from '@/lib/server/operations-server-functions.ts'

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
    <AuthenticationShell
      eyebrow="Enrollment-only session"
      title="Accept operator invitation"
    >
      {!token ? (
        <Feedback>This invitation link is missing its single-use token.</Feedback>
      ) : (
        <form
          className="mt-6 grid gap-6"
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
            })
              .then((result) => {
                if (result.state === 'redirect') window.location.assign(result.location)
                else
                  setMessage(
                    'message' in result
                      ? result.message
                      : 'The invitation could not be accepted.'
                  )
              })
              .catch(() => setMessage('The invitation could not be accepted.'))
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
      {message ? <Feedback>{message}</Feedback> : null}
    </AuthenticationShell>
  )
}
