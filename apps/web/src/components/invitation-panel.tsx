import {
  WORKSPACE_ROLES,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { useState } from 'react'
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
import { ActionFeedback } from '@/components/page/action-feedback'
import { Identifier } from '@/components/page/identifier'
import { Panel } from '@/components/page/panel'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { viewerCan, type Viewer } from '@/lib/permissions'
import {
  cancelInvitationServerFn,
  sendInvitationServerFn,
  type SentInvitation
} from '@/lib/server/invitations'
import { useServerAction } from '@/hooks/use-server-action'
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
  if (value.trim().length === 0) {
    return 'Email is required'
  }
  if (!EMAIL_PATTERN.test(value)) {
    return 'Enter a valid email address'
  }
  return
}

export function InvitationPanel({
  workspaceSlug,
  viewer,
  invitations
}: {
  readonly workspaceSlug: string
  /** The payload's viewer; `invitation:create` decides the form vs its reason. */
  readonly viewer: Viewer
  readonly invitations: ReadonlyArray<Invitation>
}) {
  // Presentation gate: the form yields to a reason for a role that cannot
  // invite; the server fn re-checks the permission regardless.
  const canInvite = viewerCan(viewer, { invitation: ['create'] })
  const [sent, setSent] = useState<SentInvitation | null>(null)

  // Same shape as `ApiTokenForm`: the server function rejects on failure and
  // the hook folds that rejection into a display message, so the failure path
  // is a value rather than a try/catch. The loader owns the invitation list, so
  // the hook re-runs it rather than mirroring the new row into local state.
  const send = useServerAction(
    (value: InvitationValues) =>
      sendInvitationServerFn({
        data: { workspaceSlug, email: value.email, role: value.role }
      }),
    { failureMessage: SEND_FAILED, onSuccess: setSent }
  )

  const cancel = useServerAction(
    (invitationId: string) =>
      cancelInvitationServerFn({ data: { workspaceSlug, invitationId } }),
    { failureMessage: CANCEL_FAILED }
  )

  const form = useForm({
    defaultValues: DEFAULT_INVITATION_VALUES,
    onSubmit: async ({ value }) => {
      const outcome = await send.runAsync(value)
      if (outcome.ok) {
        form.reset()
      }
    }
  })

  return (
    <Panel
      title="Invitations"
      description="Invite someone by email; they join once they open the link and accept."
    >
      {canInvite ? (
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
            <Alert variant="ok" className="justify-self-stretch">
              <AlertTitle>
                {sent.delivered
                  ? `Invitation sent to ${sent.invitation.email}.`
                  : `Invitation created for ${sent.invitation.email}, but the email could not be sent; share this link instead.`}
              </AlertTitle>
              <AlertDescription>
                <Identifier>{sent.inviteUrl}</Identifier>
              </AlertDescription>
            </Alert>
          ) : null}
          <ActionFeedback error={send.error} />
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          Your role cannot invite members.
        </p>
      )}

      <div className="grid gap-2">
        <h3 className="text-sm font-medium">Pending invitations</h3>
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
                      disabled={cancel.pendingInput === invitation.id}
                      onClick={() => cancel.run(invitation.id)}
                    >
                      {cancel.pendingInput === invitation.id ? (
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
        <ActionFeedback error={cancel.error} />
      </div>
    </Panel>
  )
}
