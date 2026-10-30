import { roleLabel } from '@/lib/value-labels'
import {
  type Member,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { type WorkspaceWithMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceView } from '@/lib/workspace-view'

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
import { m } from '@b2b-saas-starter/i18n/messages'
import { roleVariant } from '@/lib/badge-variants'
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
  const { view, update } = useWorkspaceView()
  const selectedId = view.record ?? users[0]?.id ?? ''
  return (
    <div className="grid gap-2 rounded-none bg-muted p-3">
      <p className="text-xs text-muted-foreground">{m.workspace_roles()}</p>
      <Select
        value={selectedId}
        onValueChange={(value) => update({ record: String(value) })}
        items={users.map((user) => ({
          value: user.id,
          label: `${user.name} (${user.email})`
        }))}
      >
        <SelectTrigger aria-label={m.select_user()} className="w-full">
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
      <UserMembershipEditor
        key={selectedId}
        users={users}
        selectedId={selectedId}
        enabled={view.record !== undefined}
        selectUser={(record) => update({ record })}
        listWorkspaces={listWorkspaces}
        changeUserRole={changeUserRole}
      />
    </div>
  )
}

function UserMembershipEditor({
  users,
  selectedId,
  enabled,
  selectUser,
  listWorkspaces,
  changeUserRole
}: {
  readonly users: ReadonlyArray<SystemUser>
  readonly selectedId: string
  readonly enabled: boolean
  readonly selectUser: (id: string) => void
  readonly listWorkspaces: ListUserWorkspaces
  readonly changeUserRole: ChangeUserWorkspaceRole
}) {
  const queryClient = useQueryClient()
  const selected = users.find((user) => user.id === selectedId)
  const loadWorkspaces = useQuery({
    queryKey: ['admin-user-workspaces', selectedId],
    queryFn: () => listWorkspaces({ data: { userId: selectedId } }),
    enabled: enabled && selected !== undefined,
    retry: false
  })
  const changeRole = useServerAction(
    (change: RoleChange) =>
      changeUserRole({
        data: {
          userId: change.member.id,
          workspaceId: change.workspaceId,
          role: change.role
        }
      }),
    {
      failureMessage: m.role_change_failed(),
      onSuccess: (_member, change) =>
        queryClient.invalidateQueries({
          queryKey: ['admin-user-workspaces', change.member.id],
          exact: true
        })
    }
  )
  const memberships = loadWorkspaces.data
  const busy = loadWorkspaces.isFetching || changeRole.pending
  const error = loadWorkspaces.isError ? m.load_workspaces_failed() : changeRole.error

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Button
          variant="ghost"
          disabled={busy || !selected}
          onClick={() =>
            enabled ? void loadWorkspaces.refetch() : selectUser(selectedId)
          }
        >
          {m.admin_load_workspaces()}
          {loadWorkspaces.isFetching ? <Spinner data-icon="inline-end" /> : null}
        </Button>
        {memberships === undefined ? null : (
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
        {m.admin_no_workspace_memberships({ name: selectedName ?? '' })}
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
            <Badge variant={roleVariant(member.role)}>{roleLabel(member.role)}</Badge>
            <RoleChangeButtons
              currentRole={member.role}
              labelFor={(role) =>
                m.shell_workspace_role({
                  workspace: workspace.name,
                  role: roleLabel(role)
                })
              }
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
