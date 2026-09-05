import {
  WORKSPACE_ROLES,
  type Member,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Panel } from '@/components/page/panel'
import { ConfirmButton } from '@/components/confirm-button'
import { RoleChangeButtons } from '@/components/role-change-buttons'
import { viewerCan, type Viewer } from '@/lib/permissions'
import {
  changeMemberRoleServerFn,
  leaveWorkspaceServerFn,
  removeMemberServerFn
} from '@/lib/server/workspace-members'
import { useServerAction } from '@/hooks/use-server-action'

const CHANGE_FAILED = 'Failed to change the role'
const REMOVE_FAILED = 'Failed to remove the member'
const LEAVE_FAILED = 'Failed to leave the workspace'

// A role is not a status: it never wears the mauve `default` (that is for
// current/selected), and the status hues stay reserved for states.
function roleVariant(role: WorkspaceRole): 'neutral' | 'secondary' | 'outline' {
  if (role === 'owner') {
    return 'neutral'
  }
  if (role === 'admin') {
    return 'secondary'
  }
  return 'outline'
}

/**
 * The workspace roster with per-member role change, removal, and the actor's
 * own leave. Presentation only: the controls render when the viewer's
 * permissions authorize them, but every change is re-checked server-side by
 * `requireWorkspacePermission` in the server fn — and the refusals the
 * capability's ownership rule makes arrive as copy, not as a failed request.
 */
export function MembersPanel({
  workspaceSlug,
  members,
  viewer,
  actorUserId
}: {
  readonly workspaceSlug: string
  readonly members: ReadonlyArray<Member>
  readonly viewer: Viewer
  /** The signed-in user's id: their own row carries the leave verb, never remove. */
  readonly actorUserId: string
}) {
  const canManage = viewerCan(viewer, { member: ['update'] })
  const canRemove = viewerCan(viewer, { member: ['delete'] })
  // Not the panel's authorization — that stays `viewerCan` above and the
  // server guard behind it. This mirrors the plugin's own `creatorRole` rule:
  // only an owner may grant or rewrite the owner role, so a non-owner actor
  // is not offered a button the workspace can only refuse.
  const offerRoles =
    viewer?.role === 'owner'
      ? WORKSPACE_ROLES
      : WORKSPACE_ROLES.filter((role) => role !== 'owner')

  // One armed confirm at a time, keyed to the row it belongs to — the same
  // shape the API tokens panel's revoke uses.
  const [confirmingRemovalId, setConfirmingRemovalId] = useState<string | null>(null)

  // The loader owns the roster, so the hook re-runs it on success rather than
  // mirroring the changed row into local state.
  const changeRole = useServerAction(
    ({ userId, role }: { readonly userId: string; readonly role: WorkspaceRole }) =>
      changeMemberRoleServerFn({ data: { workspaceSlug, userId, role } }),
    { failureMessage: CHANGE_FAILED }
  )

  const removeMember = useServerAction(
    ({ userId }: { readonly userId: string }) =>
      removeMemberServerFn({ data: { workspaceSlug, userId } }),
    { failureMessage: REMOVE_FAILED }
  )

  // Leaving is not a roster refresh: the actor's next view of this workspace
  // is the workspaces list, loaded fresh — no client cache of a membership
  // that no longer exists should outlive the click.
  const leaveWorkspace = useServerAction(
    () => leaveWorkspaceServerFn({ data: { workspaceSlug } }),
    {
      failureMessage: LEAVE_FAILED,
      invalidate: false,
      onSuccess: () => window.location.assign('/workspaces')
    }
  )

  if (members.length === 0) {
    return (
      <Panel title="Roster" description="Everyone with access to this workspace.">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No members yet</EmptyTitle>
            <EmptyDescription>Invite someone from the members page.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Panel>
    )
  }

  return (
    <Panel title="Roster" description="Everyone with access to this workspace.">
      <ItemGroup>
        {members.map((member) => {
          const isOwnRow = member.id === actorUserId
          // Same mirror of the plugin's creator-role rule as `offerRoles`:
          // an owner's role is untouchable by anyone but an owner, so a
          // non-owner actor gets no buttons on that row at all — every one
          // of them could only fail.
          const canReRole =
            canManage &&
            !isOwnRow &&
            (viewer?.role === 'owner' || member.role !== 'owner')
          const changing = changeRole.pendingInput?.userId === member.id
          const removing = removeMember.pendingInput?.userId === member.id
          return (
            <Item key={member.id} variant="outline" size="sm">
              <ItemContent>
                <ItemTitle>{member.name}</ItemTitle>
                <ItemDescription>{member.email}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={roleVariant(member.role)}>{member.role}</Badge>
                {isOwnRow ? (
                  <ConfirmButton
                    label="Leave workspace"
                    confirmLabel="Confirm leave"
                    variant="ghost"
                    busy={leaveWorkspace.pending}
                    onConfirm={() => leaveWorkspace.run()}
                  />
                ) : null}
                {canReRole ? (
                  <RoleChangeButtons
                    currentRole={member.role}
                    offerRoles={offerRoles}
                    labelFor={(role) => `Make ${role}: ${member.name}`}
                    disabled={changing}
                    busy={changing}
                    onChange={(role) => changeRole.run({ userId: member.id, role })}
                  />
                ) : null}
                {canRemove && !isOwnRow ? (
                  <ConfirmButton
                    label="Remove"
                    confirmLabel="Confirm remove"
                    target={member.name}
                    armed={confirmingRemovalId === member.id}
                    busy={removing}
                    onArm={() => setConfirmingRemovalId(member.id)}
                    onCancel={() => setConfirmingRemovalId(null)}
                    onConfirm={() => {
                      setConfirmingRemovalId(null)
                      removeMember.run({ userId: member.id })
                    }}
                  />
                ) : null}
              </ItemActions>
            </Item>
          )
        })}
      </ItemGroup>
      {canManage ? null : (
        <p className="text-xs text-muted-foreground">
          Your role cannot change member roles.
        </p>
      )}
      <ActionFeedback
        error={changeRole.error ?? removeMember.error ?? leaveWorkspace.error}
      />
    </Panel>
  )
}
