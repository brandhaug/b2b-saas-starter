import {
  type Member,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { type WorkspaceWithMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { ActionFeedback } from '@/components/page/action-feedback'
import { RoleChangeButtons } from '@/components/role-change-buttons'
import {
  changeUserWorkspaceRoleServerFn,
  listUserWorkspacesServerFn,
  type SystemUser
} from '@/lib/server/admin'
import { useServerAction } from '@/hooks/use-server-action'

/**
 * The two server calls this editor makes, as ports. Injected rather than
 * imported at the call site so a test drives the editor with real functions of
 * these shapes instead of replacing the module they live in. The defaults are
 * the production server functions, so every caller but a test passes nothing.
 */
export type ListUserWorkspaces = (input: {
  readonly data: { readonly userId: string }
}) => Promise<ReadonlyArray<WorkspaceWithMembership>>

export type ChangeUserWorkspaceRole = (input: {
  readonly data: {
    readonly userId: string
    readonly workspaceId: string
    readonly role: WorkspaceRole
  }
}) => Promise<Member>

type RoleChange = {
  readonly workspaceId: string
  readonly member: Member
  readonly role: WorkspaceRole
}

/**
 * Cross-workspace role editor under `/admin`'s users table, keyed by the
 * selected user. Ban/unban lives in `BanUserAction` on the table rows.
 * Presentation only — every change is re-gated by the admin role in the
 * server fn and again inside Better Auth's plugin.
 */
export function AdminUserActions({
  users,
  listWorkspaces = listUserWorkspacesServerFn,
  changeUserRole = changeUserWorkspaceRoleServerFn
}: {
  readonly users: ReadonlyArray<SystemUser>
  readonly listWorkspaces?: ListUserWorkspaces
  readonly changeUserRole?: ChangeUserWorkspaceRole
}) {
  const [selectedId, setSelectedId] = useState<string>(users[0]?.id ?? '')
  const [memberships, setMemberships] =
    useState<ReadonlyArray<WorkspaceWithMembership> | null>(null)

  /** The one read this editor makes: every membership held by one user. */
  function readMemberships(userId: string) {
    return listWorkspaces({ data: { userId } })
  }

  // A read, so there is no loader to re-run — it just refills the editor.
  const loadWorkspaces = useServerAction(readMemberships, {
    failureMessage: 'Failed to load workspaces',
    invalidate: false,
    onSuccess: setMemberships
  })

  // Re-reads the memberships after the write, through the same folded call, so
  // the editor shows the role it just wrote and a read failure lands in error
  // state instead of escaping as an unhandled rejection.
  const changeRole = useServerAction(
    async (change: RoleChange) => {
      await changeUserRole({
        data: {
          userId: change.member.id,
          workspaceId: change.workspaceId,
          role: change.role
        }
      })
      return readMemberships(change.member.id)
    },
    { failureMessage: 'Role change failed', onSuccess: setMemberships }
  )

  function selectUser(userId: string) {
    setSelectedId(userId)
    setMemberships(null)
    loadWorkspaces.run(userId)
  }

  const busy = loadWorkspaces.pending || changeRole.pending
  const error = loadWorkspaces.error ?? changeRole.error
  const selected = users.find((user) => user.id === selectedId)

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-none bg-muted p-3">
        <p className="text-xs text-muted-foreground">Workspace roles</p>
        <Select
          value={selectedId}
          onValueChange={(value) => selectUser(String(value))}
          items={users.map((user) => ({
            value: user.id,
            label: `${user.name} (${user.email})`
          }))}
        >
          <SelectTrigger aria-label="Select a user" className="w-full" disabled={busy}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !selectedId}
          onClick={() => selectUser(selectedId)}
        >
          Load workspaces
          {loadWorkspaces.pending ? <Spinner data-icon="inline-end" /> : null}
        </Button>
        {memberships === null ? null : (
          <MembershipList
            memberships={memberships}
            selectedName={selected?.name}
            busy={busy}
            onChangeRole={(change) => changeRole.run(change)}
          />
        )}
      </div>

      <ActionFeedback error={error} />
    </div>
  )
}

/** The loaded memberships, or the copy for a user who holds none. */
function MembershipList({
  memberships,
  selectedName,
  busy,
  onChangeRole
}: {
  readonly memberships: ReadonlyArray<WorkspaceWithMembership>
  readonly selectedName: string | undefined
  readonly busy: boolean
  readonly onChangeRole: (change: RoleChange) => void
}) {
  if (memberships.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {selectedName} holds no workspace memberships.
      </p>
    )
  }
  return (
    <ul className="grid gap-2">
      {memberships.map(({ workspace, member }) => (
        <li
          key={workspace.id}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
        >
          <span className="min-w-0 text-sm break-words">{workspace.name}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{member.role}</Badge>
            <RoleChangeButtons
              currentRole={member.role}
              labelFor={(role) => `Make ${workspace.name} role ${role}`}
              disabled={busy}
              onChange={(role) =>
                onChangeRole({ workspaceId: workspace.id, member, role })
              }
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
