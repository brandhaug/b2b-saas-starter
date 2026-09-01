import {
  WORKSPACE_ROLES,
  type Member,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { viewerCan, type Viewer } from '@/lib/permissions'
import { changeMemberRoleServerFn } from '@/lib/server/workspace-members'
import { useServerAction } from '@/hooks/use-server-action'

const CHANGE_FAILED = 'Failed to change the role'

function roleVariant(role: WorkspaceRole): 'default' | 'secondary' | 'outline' {
  if (role === 'owner') {
    return 'default'
  }
  if (role === 'admin') {
    return 'secondary'
  }
  return 'outline'
}

/** The roles a member can be moved to from their current one. */
function otherRoles(current: WorkspaceRole): ReadonlyArray<WorkspaceRole> {
  return WORKSPACE_ROLES.filter((role) => role !== current)
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
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No members yet</EmptyTitle>
          <EmptyDescription>Invite someone from settings.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="grid gap-2">
      <ItemGroup>
        {members.map((member) => (
          <Item key={member.id} variant="outline" size="sm">
            <ItemContent>
              <ItemTitle>{member.name}</ItemTitle>
              <ItemDescription>{member.email}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant={roleVariant(member.role)}>{member.role}</Badge>
              {canManage
                ? otherRoles(member.role).map((role) => (
                    <Button
                      key={role}
                      variant="ghost"
                      size="sm"
                      disabled={changeRole.pendingInput?.userId === member.id}
                      aria-label={`Make ${role}: ${member.name}`}
                      onClick={() => changeRole.run({ userId: member.id, role })}
                    >
                      {changeRole.pendingInput?.userId === member.id ? (
                        <Spinner data-icon="inline-start" />
                      ) : null}
                      Make {role}
                    </Button>
                  ))
                : null}
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {canManage ? null : (
        <p className="text-xs text-muted-foreground">
          Your role cannot change member roles.
        </p>
      )}
      {changeRole.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{changeRole.error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
