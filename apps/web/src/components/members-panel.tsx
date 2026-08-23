import {
  WORKSPACE_ROLES,
  type Member,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/src/governance/workspace-identity.ts'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Cause, Effect, Exit, Option } from 'effect'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { causeMessage } from '@/lib/cause-message'
import { viewerCan, type Viewer } from '@/lib/permissions'
import { changeMemberRoleServerFn } from '@/lib/server/workspace-members'

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
    const exit = await Effect.runPromiseExit(
      Effect.tryPromise({
        try: () => changeMemberRoleServerFn({ data: { workspaceSlug, userId, role } }),
        catch: (cause) => causeMessage(cause, CHANGE_FAILED)
      })
    )
    setChanging(null)
    if (Exit.isFailure(exit)) {
      setError(Option.getOrElse(Cause.findErrorOption(exit.cause), () => CHANGE_FAILED))
      return
    }
    // The loader owns the roster, so re-run it rather than mirroring the
    // changed row into local state.
    await router.invalidate()
  }

  if (members.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No members yet. Invite someone from settings.
      </p>
    )
  }

  return (
    <div className="grid gap-2">
      <ul className="grid gap-2">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
          >
            <div className="grid gap-0.5">
              <p className="text-sm font-medium">{member.name}</p>
              <p className="text-xs text-muted-foreground">{member.email}</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={roleVariant(member.role)}>{member.role}</Badge>
              {canManage
                ? otherRoles(member.role).map((role) => (
                    <Button
                      key={role}
                      variant="ghost"
                      size="sm"
                      disabled={changing === member.id}
                      onClick={() => void changeRole(member.id, role)}
                    >
                      Make {role}
                      {changing === member.id ? '…' : ''}
                    </Button>
                  ))
                : null}
            </div>
          </li>
        ))}
      </ul>
      {canManage ? null : (
        <p className="text-xs text-muted-foreground">
          Your role cannot change member roles.
        </p>
      )}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
