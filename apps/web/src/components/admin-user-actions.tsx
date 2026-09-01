import {
  WORKSPACE_ROLES,
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  banSystemUserServerFn,
  changeUserWorkspaceRoleServerFn,
  listUserWorkspacesServerFn,
  unbanSystemUserServerFn,
  type SystemUser
} from '@/lib/server/admin'
import { useServerAction } from '@/hooks/use-server-action'

/**
 * Cross-workspace role editor under `/admin`'s users table, keyed by the
 * selected user. Ban/unban lives in `BanUserAction` on the table rows.
 * Presentation only — every change is re-gated by the admin role in the
 * server fn and again inside Better Auth's plugin.
 */
/**
 * Row-level ban/unban for `/admin`'s users table: a confirmed destructive
 * action — the dialog names the user, cancel is the safe default. Every change
 * is re-gated by the admin role in the server fn and again inside Better
 * Auth's plugin.
 */
export function BanUserAction({ user }: { readonly user: SystemUser }) {
  const [open, setOpen] = useState(false)
  const banned = user.banned
  const verb = banned ? 'Unban' : 'Ban'

  const confirm = useServerAction(
    () =>
      banned
        ? unbanSystemUserServerFn({ data: { userId: user.id } })
        : banSystemUserServerFn({ data: { userId: user.id } }),
    { failureMessage: `${verb} failed`, onSuccess: () => setOpen(false) }
  )

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`${verb} ${user.email}`}
        onClick={() => setOpen(true)}
      >
        {verb}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>
            {verb} {user.email}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {banned
              ? 'The user will be able to sign in again.'
              : 'The user will be signed out and blocked from signing in.'}
          </AlertDialogDescription>
          {confirm.error === null ? null : (
            <p role="alert" className="text-xs text-destructive">
              {confirm.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel disabled={confirm.pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={banned ? 'default' : 'destructive'}
              disabled={confirm.pending}
              onClick={() => confirm.run()}
            >
              {confirm.pending ? <Spinner data-icon="inline-start" /> : null}
              {verb}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function AdminUserActions({
  users
}: {
  readonly users: ReadonlyArray<SystemUser>
}) {
  const [selectedId, setSelectedId] = useState<string>(users[0]?.id ?? '')
  const [memberships, setMemberships] =
    useState<ReadonlyArray<WorkspaceWithMembership> | null>(null)

  // A read, so there is no loader to re-run — it just refills the editor.
  const loadWorkspaces = useServerAction(
    (userId: string) => listUserWorkspacesServerFn({ data: { userId } }),
    {
      failureMessage: 'Failed to load workspaces',
      invalidate: false,
      onSuccess: setMemberships
    }
  )

  // Re-reads the memberships after the write, through the same folded call, so
  // the editor shows the role it just wrote and a read failure lands in error
  // state instead of escaping as an unhandled rejection.
  const changeRole = useServerAction(
    async ({
      workspaceId,
      member,
      role
    }: {
      readonly workspaceId: string
      readonly member: Member
      readonly role: WorkspaceRole
    }) => {
      await changeUserWorkspaceRoleServerFn({
        data: { userId: member.id, workspaceId, role }
      })
      return listUserWorkspacesServerFn({ data: { userId: member.id } })
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
        {(() => {
          if (memberships === null) {
            return null
          }
          if (memberships.length === 0) {
            return (
              <p className="text-xs text-muted-foreground">
                {selected?.name} holds no workspace memberships.
              </p>
            )
          }
          return (
            <ul className="grid gap-2">
              {memberships.map(({ workspace, member }) => (
                <MembershipRow
                  key={workspace.id}
                  workspaceName={workspace.name}
                  workspaceId={workspace.id}
                  member={member}
                  busy={busy}
                  onChangeRole={(target) => changeRole.run(target)}
                />
              ))}
            </ul>
          )
        })()}
      </div>

      {error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function MembershipRow(input: {
  readonly workspaceName: string
  readonly workspaceId: string
  readonly member: Member
  readonly busy: boolean
  readonly onChangeRole: (target: {
    readonly workspaceId: string
    readonly member: Member
    readonly role: WorkspaceRole
  }) => void
}) {
  // One pass over the fixed role vocabulary: keep every role this member does
  // not already hold.
  const targets: Array<WorkspaceRole> = []
  for (const role of WORKSPACE_ROLES) {
    if (role !== input.member.role) {
      targets.push(role)
    }
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <span className="min-w-0 text-sm break-all">{input.workspaceName}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{input.member.role}</Badge>
        {targets.map((role) => (
          <Button
            key={role}
            variant="ghost"
            size="sm"
            disabled={input.busy}
            aria-label={`Make ${input.workspaceName} role ${role}`}
            onClick={() =>
              input.onChangeRole({
                workspaceId: input.workspaceId,
                member: input.member,
                role
              })
            }
          >
            Make {role}
          </Button>
        ))}
      </div>
    </li>
  )
}
