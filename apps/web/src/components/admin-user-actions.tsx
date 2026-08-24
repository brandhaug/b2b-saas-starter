import {
  WORKSPACE_ROLES,
  type Member,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/src/governance/workspace-identity.ts'
import { type WorkspaceWithMembership } from '@b2b-saas-starter/capabilities/src/governance/workspace-membership.ts'
import { Cause, Effect, Exit, Option } from 'effect'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

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
import { causeMessage } from '@/lib/cause-message'
import {
  banSystemUserServerFn,
  changeUserWorkspaceRoleServerFn,
  listUserWorkspacesServerFn,
  unbanSystemUserServerFn,
  type SystemUser
} from '@/lib/server/admin'

/** Runs one server fn, folding any failure into a displayable message. */
async function callServerFn<A>(
  run: () => Promise<A>,
  fallback: string
): Promise<{ ok: true; value: A } | { ok: false; message: string }> {
  const exit = await Effect.runPromiseExit(
    Effect.tryPromise({ try: run, catch: (cause) => causeMessage(cause, fallback) })
  )
  if (Exit.isSuccess(exit)) return { ok: true, value: exit.value }
  return {
    ok: false,
    message: Option.getOrElse(Cause.findErrorOption(exit.cause), () => fallback)
  }
}

/**
 * Per-user admin actions under `/admin`'s users table: ban/unban, and a
 * cross-workspace role editor keyed by the selected user. Presentation only —
 * every change is re-gated by the admin role in the server fn and again
 * inside Better Auth's plugin.
 */
export function AdminUserActions({ users }: { readonly users: readonly SystemUser[] }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>(users[0]?.id ?? '')
  const [memberships, setMemberships] = useState<
    readonly WorkspaceWithMembership[] | null
  >(null)

  async function settle(run: () => Promise<void>, busyKey: string, message: string) {
    setError(null)
    setBusy(busyKey)
    const outcome = await callServerFn(run, `${message} failed`)
    setBusy(null)
    if (!outcome.ok) {
      setError(outcome.message)
      return false
    }
    await router.invalidate()
    return true
  }

  async function toggleBan(user: SystemUser) {
    const banned = user.banned
    const verb = banned ? 'Unban' : 'Ban'
    // The busy key is scoped to the user so only the acting row shows a
    // spinner; the visible/accessible label stays stable while pending.
    await settle(
      () => {
        if (banned) {
          return unbanSystemUserServerFn({ data: { userId: user.id } }).then(
            () => undefined
          )
        }
        return banSystemUserServerFn({ data: { userId: user.id } }).then(
          () => undefined
        )
      },
      `${verb}:${user.id}`,
      verb
    )
  }

  async function loadWorkspaces(userId: string) {
    setSelectedId(userId)
    setMemberships(null)
    setError(null)
    setBusy('Workspaces')
    const outcome = await callServerFn(() => {
      return listUserWorkspacesServerFn({ data: { userId } })
    }, 'Failed to load workspaces')
    setBusy(null)
    if (!outcome.ok) {
      setError(outcome.message)
      return
    }
    setMemberships(outcome.value)
  }

  async function changeRole(workspaceId: string, member: Member, role: WorkspaceRole) {
    // Re-read the memberships after the write so the editor shows the role it
    // just wrote.
    const settled = await settle(
      () => {
        return changeUserWorkspaceRoleServerFn({
          data: { userId: member.id, workspaceId, role }
        }).then(() => undefined)
      },
      'Role change',
      'Role change'
    )
    if (!settled) return
    const read = await listUserWorkspacesServerFn({ data: { userId: member.id } })
    setMemberships(read)
  }

  const selected = users.find((user) => user.id === selectedId)

  return (
    <div className="grid gap-4">
      <ul className="grid gap-2">
        {users.map((user) => (
          <li
            key={user.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
          >
            <span className="min-w-0 text-sm break-all text-muted-foreground">
              {user.email}
            </span>
            <Button
              variant={user.banned ? 'outline' : 'destructive'}
              size="sm"
              disabled={busy !== null}
              aria-label={`${user.banned ? 'Unban' : 'Ban'} ${user.email}`}
              onClick={() => void toggleBan(user)}
            >
              {user.banned ? 'Unban' : 'Ban'}
              {busy === `${user.banned ? 'Unban' : 'Ban'}:${user.id}` ? (
                <Spinner data-icon="inline-end" />
              ) : null}
            </Button>
          </li>
        ))}
      </ul>

      <div className="grid gap-2 rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">Workspace roles</p>
        <Select
          value={selectedId}
          onValueChange={(value) => void loadWorkspaces(String(value))}
          items={users.map((user) => ({
            value: user.id,
            label: `${user.name} (${user.email})`
          }))}
        >
          <SelectTrigger
            aria-label="Select a user"
            className="w-full"
            disabled={busy !== null}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {users.map((user) => (
              <SelectGroup key={user.id}>
                <SelectItem value={user.id}>
                  {user.name} ({user.email})
                </SelectItem>
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null || !selectedId}
          onClick={() => void loadWorkspaces(selectedId)}
        >
          Load workspaces
          {busy === 'Workspaces' ? <Spinner data-icon="inline-end" /> : null}
        </Button>
        {(() => {
          if (memberships === null) return null
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
                  busy={busy !== null}
                  onChangeRole={changeRole}
                />
              ))}
            </ul>
          )
        })()}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

function MembershipRow(input: {
  readonly workspaceName: string
  readonly workspaceId: string
  readonly member: Member
  readonly busy: boolean
  readonly onChangeRole: (
    workspaceId: string,
    member: Member,
    role: WorkspaceRole
  ) => Promise<void>
}) {
  // One pass over the fixed role vocabulary: keep every role this member does
  // not already hold.
  const targets: WorkspaceRole[] = []
  for (const role of WORKSPACE_ROLES) {
    if (role !== input.member.role) targets.push(role)
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
              void input.onChangeRole(input.workspaceId, input.member, role)
            }
          >
            Make {role}
          </Button>
        ))}
      </div>
    </li>
  )
}
