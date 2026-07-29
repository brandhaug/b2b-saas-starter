import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Feedback,
  Field,
  OperationsShell,
  SubmitButton
} from '@/components/operations-ui.tsx'
import { formValue } from '@/lib/form-value.ts'
import { requireOperationsSession } from '@/lib/require-operations-session.ts'
import {
  inviteOperator,
  revokeOperatorInvitation
} from '@/lib/server/operations-server-functions.ts'
import { operatorRoleOptions } from '@b2b-saas-starter/capabilities/operations'

export const Route = createFileRoute('/operators_/invitations/new')({
  beforeLoad: requireOperationsSession,
  component: InviteOperatorPage
})

function InviteOperatorPage() {
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invitation, setInvitation] = useState<{
    readonly id: string
    readonly email: string
    readonly expiresAt: string
  } | null>(null)
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
          })
            .then((result) => {
              if (result.state === 'ready') {
                setInvitation(result.data.invitation)
                setNotice(
                  `Invitation sent to ${result.data.invitation.email}. It expires at ${result.data.invitation.expiresAt}.`
                )
              } else if (result.state === 'redirect')
                window.location.assign(result.location)
              else setError(result.message)
            })
            .catch(() => setError('The invitation could not be sent.'))
        }}
      >
        <Field label="Dedicated operator email" name="email" type="email" required />
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold">Initial roles</legend>
          {operatorRoleOptions.map((role) => (
            <label className="flex gap-2 text-sm" key={role.value}>
              <input name="roles" type="checkbox" value={role.value} />
              {role.label}
            </label>
          ))}
        </fieldset>
        <SubmitButton>Send single-use invitation</SubmitButton>
      </form>
      {notice ? <Feedback status>{notice}</Feedback> : null}
      {invitation ? (
        <details className="mt-4 max-w-xl border border-destructive p-4">
          <summary className="cursor-pointer text-sm font-medium text-destructive">
            Revoke invitation
          </summary>
          <p className="mt-3 text-sm text-muted-foreground">
            This invitation will stop working immediately.
          </p>
          <button
            className="mt-4 h-9 rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground"
            onClick={() => {
              setError(null)
              void revokeOperatorInvitation({
                data: { invitationId: invitation.id }
              })
                .then((result) => {
                  if (result.state === 'redirect')
                    window.location.assign(result.location)
                  else if (result.state === 'ready') {
                    setInvitation(null)
                    setNotice('Invitation revoked.')
                  } else setError(result.message)
                })
                .catch(() => setError('The invitation could not be revoked.'))
            }}
            type="button"
          >
            Confirm revoke invitation
          </button>
        </details>
      ) : null}
      {error ? <Feedback>{error}</Feedback> : null}
    </OperationsShell>
  )
}
