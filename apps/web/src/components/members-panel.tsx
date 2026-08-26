import {
  WORKSPACE_ROLES,
  type Member,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

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
import { callServerFn } from '@/lib/server-call'

const CHANGE_FAILED = 'Failed to change the role'

function roleVariant(role: WorkspaceRole): 'default' | 'secondary' | 'outline' {
  if (role === 'owner') return 'default'
  if (role === 'admin') return 'secondary'
  return 'outline'
}

/** The roles a member can be moved to from their current one. */
function otherRoles(current: WorkspaceRole): readonly WorkspaceRole[] {
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
  readonly members: readonly Member[]
  readonly viewer: Viewer
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [changing, setChanging] = useState<string | null>(null)

  const canManage = viewerCan(viewer, { member: ['update'] })

  async function changeRole(userId: string, role: WorkspaceRole) {
    setError(null)
    setChanging(userId)
    const outcome = await callServerFn(
      () => changeMemberRoleServerFn({ data: { workspaceSlug, userId, role } }),
      CHANGE_FAILED
    )
    setChanging(null)
    if (!outcome.ok) {
      setError(outcome.message)
      return
    }
    // The loader owns the roster, so re-run it rather than mirroring the
    // changed row into local state.
    await router.invalidate()
  }

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
                      disabled={changing === member.id}
                      aria-label={`Make ${role}: ${member.name}`}
                      onClick={() => void changeRole(member.id, role)}
                    >
                      {changing === member.id ? (
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
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
