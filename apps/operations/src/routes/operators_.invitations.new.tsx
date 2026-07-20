import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Feedback,
  Field,
  OperationsShell,
  SubmitButton
} from '@/components/operations-ui.tsx'
import { formValue } from '@/lib/form-value.ts'
import { inviteOperator } from '@/lib/server/operations.ts'

const roles = [
  'merchant-reader',
  'merchant-impersonator',
  'impersonation-auditor',
  'operator-manager'
] as const

export const Route = createFileRoute('/operators_/invitations/new')({
  component: InviteOperatorPage
})

function InviteOperatorPage() {
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <OperationsShell eyebrow="Controlled provisioning" title="Invite System Operator">
      <Link
        className="text-sm text-primary"
        search={{ result: undefined, error: undefined }}
        to="/operators"
      >
        ← Back to System Operators
      </Link>
      <form
        className="mt-6 grid max-w-xl gap-6 border border-border bg-card p-6"
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          setError(null)
          setNotice(null)
          void inviteOperator({
            data: {
              email: formValue(form, 'email'),
              roles: form
                .getAll('roles')
                .filter((role): role is string => typeof role === 'string')
            }
          }).then((result) => {
            if (result.state === 'ready')
              setNotice(
                `Invitation sent to ${result.data.invitation.email}. It expires at ${result.data.invitation.expiresAt}.`
              )
            else if (result.state === 'redirect')
              window.location.assign(result.location)
            else setError(result.message)
          })
        }}
      >
        <Field label="Dedicated operator email" name="email" type="email" required />
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold">Initial roles</legend>
          {roles.map((role) => (
            <label className="flex gap-2 text-sm" key={role}>
              <input name="roles" type="checkbox" value={role} />
              {role}
            </label>
          ))}
        </fieldset>
        <SubmitButton>Send single-use invitation</SubmitButton>
      </form>
      {notice ? <Feedback status>{notice}</Feedback> : null}
      {error ? <Feedback>{error}</Feedback> : null}
    </OperationsShell>
  )
}
