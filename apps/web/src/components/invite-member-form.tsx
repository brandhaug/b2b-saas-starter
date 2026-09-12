import { m } from '@b2b-saas-starter/i18n/messages'
import { type WorkspaceRole } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useServerAction } from '@/hooks/use-server-action'
import { EMAIL_PATTERN } from '@/lib/email-pattern'
import { workspaceRoles } from '@/lib/permissions'
import { sendInvitationServerFn, type SentInvitation } from '@/lib/server/invitations'
import { roleLabel } from '@/lib/value-labels'

type SendResult =
  | { readonly email: string; readonly ok: true; readonly sent: SentInvitation }
  | { readonly email: string; readonly ok: false; readonly message: string }

function addressesFrom(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,]+/u)
        .map((email) => email.trim())
        .filter(Boolean)
    )
  ]
}

export function InviteMemberForm({
  workspaceSlug
}: {
  readonly workspaceSlug: string
}) {
  const [emails, setEmails] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('member')
  const [batchRole, setBatchRole] = useState<WorkspaceRole | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [results, setResults] = useState<ReadonlyArray<SendResult>>([])
  const send = useServerAction(
    ({
      email,
      role: invitationRole
    }: {
      readonly email: string
      readonly role: WorkspaceRole
    }) =>
      sendInvitationServerFn({
        data: { workspaceSlug, email, role: invitationRole }
      }),
    { failureMessage: m.invitation_send_failed() }
  )

  async function sendAddresses(
    addresses: ReadonlyArray<string>,
    invitationRole: WorkspaceRole
  ) {
    const next: Array<SendResult> = []
    // Invitations deliberately run in order: the UI reports a stable result for
    // each address and reuses the existing one-at-a-time server mutation.
    for (const email of addresses) {
      // eslint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop
      const outcome = await send.runAsync({ email, role: invitationRole })
      next.push(
        outcome.ok
          ? { email, ok: true, sent: outcome.value }
          : { email, ok: false, message: outcome.message }
      )
    }
    setResults((current) => {
      const attempted = new Set(addresses)
      return [...current.filter((result) => !attempted.has(result.email)), ...next]
    })
    if (next.every((result) => result.ok)) {
      setEmails('')
    }
  }

  function submit() {
    const addresses = addressesFrom(emails)
    if (addresses.length === 0) {
      setValidationError(m.invitation_batch_required())
      return
    }
    const invalid = addresses.filter((email) => !EMAIL_PATTERN.test(email))
    if (invalid.length > 0) {
      setValidationError(m.invitation_batch_invalid({ emails: invalid.join(', ') }))
      return
    }
    setValidationError(null)
    setResults([])
    setBatchRole(role)
    void sendAddresses(addresses, role)
  }

  const failed = results.filter((result) => !result.ok)
  const succeeded = results.length - failed.length
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Field data-invalid={validationError === null ? undefined : true}>
        <FieldLabel htmlFor="invitation-emails">
          {m.invitation_emails_label()}
        </FieldLabel>
        <Textarea
          id="invitation-emails"
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
          placeholder={m.invitation_email_placeholder()}
          aria-invalid={validationError === null ? undefined : true}
          aria-describedby="invitation-emails-hint"
          rows={4}
          disabled={send.pending}
        />
        <FieldDescription id="invitation-emails-hint">
          {validationError ?? m.invitation_emails_hint()}
        </FieldDescription>
      </Field>
      <FieldSet>
        <FieldLegend variant="label">{m.common_role()}</FieldLegend>
        <RadioGroup
          value={role}
          onValueChange={setRole}
          disabled={send.pending}
          className="flex flex-wrap gap-3"
        >
          {workspaceRoles.map((candidate) => (
            <FieldLabel key={candidate}>
              <RadioGroupItem value={candidate} />
              <span>{roleLabel(candidate)}</span>
            </FieldLabel>
          ))}
        </RadioGroup>
      </FieldSet>
      <Button type="submit" disabled={send.pending} className="justify-self-start">
        {send.pending ? <Spinner data-icon="inline-start" /> : null}
        {m.form_send_invitation()}
      </Button>
      {results.length > 0 ? (
        <Alert variant={failed.length === 0 ? 'ok' : 'destructive'}>
          <AlertTitle>
            {m.invitation_batch_summary({ sent: succeeded, failed: failed.length })}
          </AlertTitle>
          <AlertDescription className="grid gap-2">
            <ul className="grid gap-1">
              {results.map((result) => (
                <li key={result.email} className="flex min-w-0 items-start gap-2">
                  <Badge variant={result.ok ? 'ok' : 'destructive'}>
                    {result.ok
                      ? m.invitation_batch_success()
                      : m.invitation_batch_failure()}
                  </Badge>
                  <div className="grid min-w-0 gap-0.5">
                    <span className="break-all">{result.email}</span>
                    {result.ok ? null : (
                      <span className="text-xs/relaxed text-muted-foreground">
                        {result.message}
                      </span>
                    )}
                  </div>
                  {result.ok && result.sent.status === 'failed' ? (
                    <span className="text-muted-foreground">
                      {m.workspace_invitation_created_unsent({ email: result.email })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {failed.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                disabled={send.pending || batchRole === null}
                className="justify-self-start"
                onClick={() => {
                  if (batchRole !== null) {
                    void sendAddresses(
                      failed.map((result) => result.email),
                      batchRole
                    )
                  }
                }}
              >
                {send.pending ? <Spinner data-icon="inline-start" /> : null}
                {m.invitation_retry_failed()}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </form>
  )
}
