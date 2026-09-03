import {
  type Member,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'

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
import { RoleChangeButtons } from '@/components/role-change-buttons'
import { viewerCan, type Viewer } from '@/lib/permissions'
import { changeMemberRoleServerFn } from '@/lib/server/workspace-members'
import { useServerAction } from '@/hooks/use-server-action'

const CHANGE_FAILED = 'Failed to change the role'

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
 * The workspace roster with per-member role change. Presentation only: the
 * control renders when `member:update` authorizes it, but every change is
 * re-checked server-side by `requireWorkspacePermission` in the server fn.
 */
export function MembersPanel({
  workspaceSlug,
  members,
  viewer
}: {
  readonly workspaceSlug: string
  readonly members: ReadonlyArray<Member>
  readonly viewer: Viewer
}) {
  const canManage = viewerCan(viewer, { member: ['update'] })

  // The loader owns the roster, so the hook re-runs it on success rather than
  // mirroring the changed row into local state.
  const changeRole = useServerAction(
    ({ userId, role }: { readonly userId: string; readonly role: WorkspaceRole }) =>
      changeMemberRoleServerFn({ data: { workspaceSlug, userId, role } }),
    { failureMessage: CHANGE_FAILED }
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
          const changing = changeRole.pendingInput?.userId === member.id
          return (
            <Item key={member.id} variant="outline" size="sm">
              <ItemContent>
                <ItemTitle>{member.name}</ItemTitle>
                <ItemDescription>{member.email}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={roleVariant(member.role)}>{member.role}</Badge>
                {canManage ? (
                  <RoleChangeButtons
                    currentRole={member.role}
                    labelFor={(role) => `Make ${role}: ${member.name}`}
                    disabled={changing}
                    busy={changing}
                    onChange={(role) => changeRole.run({ userId: member.id, role })}
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
      <ActionFeedback error={changeRole.error} />
    </Panel>
  )
}
