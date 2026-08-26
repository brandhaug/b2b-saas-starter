import {
  WORKSPACE_ROLES,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'

import { FormTextField } from '@/components/form-text-field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import {
  cancelInvitationServerFn,
  sendInvitationServerFn,
  type SentInvitation
} from '@/lib/server/invitations'
import { callServerFn } from '@/lib/server-call'
import { EMAIL_PATTERN } from '@/lib/email-pattern'
import { invitationStatusVariant } from '@/lib/badge-variants'

const SEND_FAILED = 'Failed to send the invitation'
const CANCEL_FAILED = 'Failed to cancel the invitation'

type InvitationValues = {
  email: string
  role: WorkspaceRole
}

const DEFAULT_INVITATION_VALUES: InvitationValues = {
  email: '',
  role: 'member'
}

function validateEmail(value: string): string | undefined {
  if (value.trim().length === 0) return 'Email is required'
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid email address'
  return
}

export function InvitationPanel({
  workspaceSlug,
  invitations
}: {
  readonly workspaceSlug: string
  readonly invitations: readonly Invitation[]
}) {
  const router = useRouter()
  const [sent, setSent] = useState<SentInvitation | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const form = useForm({
    defaultValues: DEFAULT_INVITATION_VALUES,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      // Same shape as `ApiTokenForm`: the server function rejects on failure
      // and `callServerFn` folds that rejection into a display message, so the
      // failure path is a value rather than a try/catch.
      const outcome = await callServerFn(
        () =>
          sendInvitationServerFn({
            data: { workspaceSlug, email: value.email, role: value.role }
          }),
        SEND_FAILED
      )
      if (!outcome.ok) {
        setSubmitError(outcome.message)
        return
      }
      setSent(outcome.value)
      form.reset()
      // The loader owns the invitation list, so re-run it rather than mirroring
      // the new row into local state.
      await router.invalidate()
    }
  })

  async function cancel(invitationId: string) {
    setCancelError(null)
    setCancelling(invitationId)
    const outcome = await callServerFn(
      () => cancelInvitationServerFn({ data: { workspaceSlug, invitationId } }),
      CANCEL_FAILED
    )
    setCancelling(null)
    if (!outcome.ok) {
      setCancelError(outcome.message)
      return
    }
    await router.invalidate()
  }

  return (
    <div className="grid gap-5">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className="grid gap-4"
      >
        <form.Field
          name="email"
          validators={{ onChange: ({ value }) => validateEmail(value) }}
        >
          {(field) => (
            <FormTextField
              name={field.name}
              label="Invite by email"
              value={field.state.value}
              errors={field.state.meta.errors}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              placeholder="teammate@example.com"
            />
          )}
        </form.Field>

        <form.Field name="role">
          {(field) => (
            <FieldSet>
              <FieldLegend variant="label">Role</FieldLegend>
              <RadioGroup
                name={field.name}
                value={field.state.value}
                onValueChange={(role) => field.handleChange(role)}
                className="flex flex-wrap gap-3"
              >
                {WORKSPACE_ROLES.map((role) => (
                  <FieldLabel key={role}>
                    <RadioGroupItem value={role} />
                    <span>{role}</span>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldSet>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state): readonly [boolean, boolean] => [
            state.canSubmit,
            state.isSubmitting
          ]}
        >
          {([canSubmit, isSubmitting]) => (
            <Button
              type="submit"
              disabled={!canSubmit || isSubmitting}
              className="justify-self-start"
            >
              {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
              Send invitation
            </Button>
          )}
        </form.Subscribe>

        {sent ? (
          <Alert className="justify-self-stretch">
            <AlertTitle>
              {sent.delivered
                ? `Invitation sent to ${sent.invitation.email}.`
                : `Invitation created for ${sent.invitation.email}, but the email could not be sent; share this link instead.`}
            </AlertTitle>
            <AlertDescription>
              <code className="break-all">{sent.inviteUrl}</code>
            </AlertDescription>
          </Alert>
        ) : null}
        {submitError ? (
          <Alert variant="destructive">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}
      </form>

      <div className="grid gap-2">
        <h3 className="text-sm font-medium">Invitations</h3>
        {invitations.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No invitations yet</EmptyTitle>
              <EmptyDescription>Invite someone above.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup>
            {invitations.map((invitation) => (
              <Item key={invitation.id} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>{invitation.email}</ItemTitle>
                  <ItemDescription>{invitation.role}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Badge variant={invitationStatusVariant(invitation.status)}>
                    {invitation.status}
                  </Badge>
                  {invitation.status === 'pending' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={cancelling === invitation.id}
                      onClick={() => void cancel(invitation.id)}
                    >
                      {cancelling === invitation.id ? (
                        <Spinner data-icon="inline-start" />
                      ) : null}
                      Cancel
                    </Button>
                  ) : null}
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
        {cancelError ? (
          <Alert variant="destructive">
            <AlertDescription>{cancelError}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </div>
  )
}
