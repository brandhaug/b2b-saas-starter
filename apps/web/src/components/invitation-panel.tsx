import { roleLabel, statusLabel } from '@/lib/value-labels'
import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle
} from '@/components/ui/empty'
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
import { ListSection, Panel } from '@/components/page/panel'
import { Spinner } from '@/components/ui/spinner'
import { viewerCan, type Viewer } from '@/lib/permissions'
import {
  cancelInvitationServerFn,
  resendInvitationServerFn,
  type SentInvitation
} from '@/lib/server/invitations'
import { useServerAction } from '@/hooks/use-server-action'
import { useKeyedFailure } from '@/hooks/use-keyed-failure'
import { invitationStatusVariant } from '@/lib/badge-variants'
import { m } from '@b2b-saas-starter/i18n/messages'
import { type EmailDeliveryRow } from '@/lib/server/email-delivery'
import { Input } from '@/components/ui/input'
import { TableViewControls } from '@/components/table-view-controls'
import { applyTableView, type TableViewField } from '@/lib/table-view'
import { useTableView } from '@/lib/use-table-view'
import { useWorkspaceView } from '@/lib/workspace-view'

function invitationListFields(): ReadonlyArray<TableViewField> {
  return [
    { id: 'email', label: m.provider_email(), kind: 'text' },
    {
      id: 'role',
      label: m.common_role(),
      kind: 'select',
      options: [
        { value: 'owner', label: roleLabel('owner') },
        { value: 'admin', label: roleLabel('admin') },
        { value: 'member', label: roleLabel('member') }
      ]
    },
    {
      id: 'status',
      label: m.developer_list_status(),
      kind: 'select',
      options: ['pending', 'accepted', 'rejected', 'canceled'].map((value) => ({
        value,
        label: statusLabel(value)
      }))
    },
    { id: 'expiresAt', label: m.token_expires(), kind: 'date' }
  ]
}

function invitationSendLabel(sent: SentInvitation) {
  const values = { email: sent.invitation.email }
  if (sent.status === 'accepted') {
    return m.email_delivery_invitation_accepted(values)
  }
  if (sent.status === 'logged') {
    return m.email_delivery_invitation_logged(values)
  }
  return m.workspace_invitation_created_unsent(values)
}

export function InvitationPanel({
  workspaceSlug,
  viewer,
  invitations,
  emailDeliveries
}: {
  readonly workspaceSlug: string
  /** The payload's viewer; `invitation:create` decides the form vs its reason. */
  readonly viewer: Viewer
  readonly invitations: ReadonlyArray<Invitation>
  readonly emailDeliveries: ReadonlyArray<EmailDeliveryRow>
}) {
  // Presentation gate: the form yields to a reason for a role that cannot
  // invite; the server fn re-checks the permission regardless.
  const canInvite = viewerCan(viewer, { invitation: ['create'] })
  const { view, update } = useWorkspaceView()
  const fields = invitationListFields()
  const table = useTableView('invitations', fields, false)
  const query = view.invitationQuery ?? ''
  const normalized = query.trim().toLocaleLowerCase()
  const visibleInvitations = applyTableView(
    invitations.filter(
      (invitation) =>
        normalized === '' || invitation.email.toLocaleLowerCase().includes(normalized)
    ),
    table.view,
    (invitation, field) => {
      if (field === 'expiresAt') {
        return new Date(invitation.expiresAt)
      }
      if (field === 'role') {
        return invitation.role
      }
      if (field === 'status') {
        return invitation.status
      }
      return invitation.email
    }
  )
  const [sent, setSent] = useState<SentInvitation | null>(null)

  const cancel = useServerAction(
    (invitationId: string) =>
      cancelInvitationServerFn({ data: { workspaceSlug, invitationId } }),
    {
      failureMessage: m.invitation_cancel_failed(),
      onSuccess: (_, invitationId) => {
        const invitation = invitations.find(
          (candidate) => candidate.id === invitationId
        )
        toast.success(
          invitation === undefined
            ? m.workspace_invitation_canceled()
            : m.workspace_invitation_canceled_named({ email: invitation.email })
        )
      }
    }
  )

  const resend = useServerAction(
    (invitationId: string) =>
      resendInvitationServerFn({ data: { workspaceSlug, invitationId } }),
    {
      failureMessage: m.email_delivery_resend_failed(),
      onSuccess: (result) => setSent(result)
    }
  )

  // A cancel failure renders on the row that produced it and is cleared by
  // the next cancel — the shared per-row failure hook.
  const { failure: failedRow, runWith: cancelOnRow } = useKeyedFailure<string>()

  return (
    <Panel
      title={m.panel_invitations()}
      description={m.panel_invitations_description()}
    >
      {canInvite ? null : (
        <p className="text-sm text-muted-foreground">{m.workspace_invite_denied()}</p>
      )}
      {sent ? (
        <Alert variant="ok">
          <AlertTitle>{invitationSendLabel(sent)}</AlertTitle>
          <AlertDescription>
            <Identifier>{sent.inviteUrl}</Identifier>
          </AlertDescription>
        </Alert>
      ) : null}
      <ActionFeedback error={resend.error} />

      <ListSection title={m.pending_invitations()}>
        {invitations.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{m.empty_no_invitations()}</EmptyTitle>
              <EmptyDescription>{m.empty_sent_invitations()}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="grid gap-3 pb-3">
              <Input
                value={query}
                placeholder={m.developer_list_search_invitations()}
                aria-label={m.developer_list_search_invitations()}
                onChange={(event) =>
                  update(
                    {
                      invitationQuery: event.target.value || undefined
                    },
                    true
                  )
                }
              />
              <TableViewControls
                fields={fields}
                view={table.view}
                onChange={table.setView}
              />
            </div>
            {visibleInvitations.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{m.developer_list_no_matching_invitations()}</EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      update({
                        invitationQuery: undefined,
                        tableViews: undefined,
                        page: undefined
                      })
                    }
                  >
                    {m.developer_list_clear_all()}
                  </Button>
                </EmptyContent>
              </Empty>
            ) : null}
            {visibleInvitations.length === 0 ? null : (
              <ItemGroup>
                {visibleInvitations.map((invitation) => (
                  <Item key={invitation.id} variant="outline" size="sm">
                    <ItemContent>
                      <ItemTitle>{invitation.email}</ItemTitle>
                      <ItemDescription>{roleLabel(invitation.role)}</ItemDescription>
                      {failedRow?.key === invitation.id ? (
                        <ActionFeedback error={failedRow.message} />
                      ) : null}
                    </ItemContent>
                    <ItemActions>
                      {canInvite && invitation.status === 'pending' ? (
                        <Button
                          variant="outline"
                          disabled={
                            resend.pendingInput === invitation.id ||
                            emailDeliveries.find(
                              (record) => record.referenceId === invitation.id
                            )?.resendAllowed === false
                          }
                          onClick={() => void resend.runAsync(invitation.id)}
                        >
                          {m.email_delivery_resend_invitation()}
                        </Button>
                      ) : null}
                      <Badge variant={invitationStatusVariant(invitation.status)}>
                        {statusLabel(invitation.status)}
                      </Badge>
                      {invitation.status === 'pending' ? (
                        <Button
                          variant="ghost"
                          disabled={cancel.pendingInput === invitation.id}
                          onClick={() =>
                            void cancelOnRow(invitation.id, () =>
                              cancel.runAsync(invitation.id)
                            )
                          }
                        >
                          {cancel.pendingInput === invitation.id ? (
                            <Spinner data-icon="inline-start" />
                          ) : null}
                          {m.common_cancel()}
                        </Button>
                      ) : null}
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </>
        )}
      </ListSection>
    </Panel>
  )
}
