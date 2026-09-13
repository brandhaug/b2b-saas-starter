import { m } from '@b2b-saas-starter/i18n/messages'
import {
  type Member,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { MoreHorizontalIcon, SearchIcon } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { ActionFeedback } from '@/components/page/action-feedback'
import { ConfirmButton } from '@/components/confirm-button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { TableViewControls } from '@/components/table-view-controls'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { useKeyedFailure } from '@/hooks/use-keyed-failure'
import { useServerAction } from '@/hooks/use-server-action'
import { viewerCan, workspaceRoles, type Viewer } from '@/lib/permissions'
import {
  changeMemberRoleServerFn,
  leaveWorkspaceServerFn,
  removeMemberServerFn
} from '@/lib/server/workspace-members'
import { roleLabel } from '@/lib/value-labels'
import { useWorkspaceView } from '@/lib/workspace-view'
import { applyTableView, type TableViewField } from '@/lib/table-view'
import { useTableView } from '@/lib/use-table-view'

const PAGE_SIZE = 20

function memberListFields(): ReadonlyArray<TableViewField> {
  return [
    { id: 'name', label: m.developer_list_name(), kind: 'text' },
    { id: 'email', label: m.provider_email(), kind: 'text' },
    {
      id: 'role',
      label: m.common_role(),
      kind: 'select',
      options: workspaceRoles.map((role) => ({ value: role, label: roleLabel(role) }))
    }
  ]
}

function pageFrom(value: string | undefined) {
  const parsed = Number.parseInt(value ?? '1', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

type MemberActionsProps = {
  readonly member: Member
  readonly actorUserId: string
  readonly canManage: boolean
  readonly canRemove: boolean
  readonly viewer: Viewer
  readonly changing: boolean
  readonly removing: boolean
  readonly leaving: boolean
  readonly leaveArmed: boolean
  readonly onRoleChange: (role: WorkspaceRole) => void
  readonly onRemove: () => void
  readonly onLeave: () => void
  readonly onLeaveArm: () => void
  readonly onLeaveCancel: () => void
}

function MemberActions({
  member,
  actorUserId,
  canManage,
  canRemove,
  viewer,
  changing,
  removing,
  leaving,
  leaveArmed,
  onRoleChange,
  onRemove,
  onLeave,
  onLeaveArm,
  onLeaveCancel
}: MemberActionsProps) {
  const ownRow = member.id === actorUserId
  const canReRole =
    canManage && !ownRow && (viewer?.role === 'owner' || member.role !== 'owner')
  const offerRoles =
    viewer?.role === 'owner'
      ? workspaceRoles
      : workspaceRoles.filter((role) => role !== 'owner')
  const hasMenu = ownRow || canReRole || canRemove
  return (
    <ItemActions>
      <Badge variant="neutral">{roleLabel(member.role)}</Badge>
      {ownRow && leaveArmed ? (
        <ConfirmButton
          label={m.action_leave_workspace()}
          confirmLabel={m.action_confirm_leave()}
          variant="ghost"
          busy={leaving}
          armed
          onArm={onLeaveArm}
          onCancel={onLeaveCancel}
          onConfirm={onLeave}
        />
      ) : null}
      {hasMenu && !leaveArmed ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={m.members_more_actions({ name: member.name })}
              />
            }
          >
            {changing || removing ? <Spinner /> : <MoreHorizontalIcon />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canReRole ? (
              <DropdownMenuGroup>
                <DropdownMenuGroupLabel>
                  {m.members_change_role()}
                </DropdownMenuGroupLabel>
                {offerRoles.flatMap((role) =>
                  role === member.role
                    ? []
                    : [
                        <DropdownMenuItem
                          key={role}
                          disabled={changing}
                          onClick={() => onRoleChange(role)}
                        >
                          {m.shell_make_role({ role: roleLabel(role) })}
                        </DropdownMenuItem>
                      ]
                )}
              </DropdownMenuGroup>
            ) : null}
            {canReRole && canRemove ? <DropdownMenuSeparator /> : null}
            {ownRow ? (
              <DropdownMenuItem onClick={onLeaveArm}>
                {m.action_leave_workspace()}
              </DropdownMenuItem>
            ) : null}
            {canRemove && !ownRow ? (
              <DropdownMenuItem
                className="text-destructive focus-visible:text-destructive"
                onClick={onRemove}
              >
                {m.action_remove()}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </ItemActions>
  )
}

export function MembersPanel({
  workspaceSlug,
  members,
  viewer,
  actorUserId
}: {
  readonly workspaceSlug: string
  readonly members: ReadonlyArray<Member>
  readonly viewer: Viewer
  readonly actorUserId: string
}) {
  const canManage = viewerCan(viewer, { member: ['update'] })
  const canRemove = viewerCan(viewer, { member: ['delete'] })
  const { view, update } = useWorkspaceView()
  const fields = memberListFields()
  const table = useTableView('members', fields)
  const query = view.query ?? ''
  const requestedPage = pageFrom(view.page)
  const [confirmingMember, setConfirmingMember] = useState<Member | null>(null)
  const [leaveArmed, setLeaveArmed] = useState(false)
  const { failure: failedRow, runWith: runOnRow } = useKeyedFailure<string>()
  const changeRole = useServerAction(
    ({ userId, role }: { readonly userId: string; readonly role: WorkspaceRole }) =>
      changeMemberRoleServerFn({ data: { workspaceSlug, userId, role } }),
    {
      failureMessage: m.member_role_change_failed(),
      onSuccess: (_, { userId, role }) => {
        const member = members.find((candidate) => candidate.id === userId)
        toast.success(
          member === undefined
            ? m.workspace_role_changed({ role })
            : m.workspace_role_changed_named({ name: member.name, role })
        )
      }
    }
  )
  const removeMember = useServerAction(
    ({ userId }: { readonly userId: string }) =>
      removeMemberServerFn({ data: { workspaceSlug, userId } }),
    {
      failureMessage: m.member_remove_failed(),
      onSuccess: (_, { userId }) => {
        const member = members.find((candidate) => candidate.id === userId)
        toast.success(
          member === undefined
            ? m.workspace_member_removed()
            : m.workspace_member_removed_named({ name: member.name })
        )
      }
    }
  )
  const leaveWorkspace = useServerAction(
    () => leaveWorkspaceServerFn({ data: { workspaceSlug } }),
    {
      failureMessage: m.member_leave_failed(),
      invalidate: false,
      onSuccess: () => window.location.assign('/workspaces')
    }
  )
  const normalized = query.trim().toLocaleLowerCase()
  const searchedMembers = members.filter(
    (member) =>
      normalized.length === 0 ||
      member.name.toLocaleLowerCase().includes(normalized) ||
      member.email.toLocaleLowerCase().includes(normalized)
  )
  const filteredMembers = applyTableView(
    searchedMembers,
    table.view,
    (member, field) => {
      if (field === 'role') {
        return member.role
      }
      if (field === 'email') {
        return member.email
      }
      return member.name
    }
  )
  const pageCount = Math.max(1, Math.ceil(filteredMembers.length / PAGE_SIZE))
  const page = Math.min(requestedPage, pageCount)
  const visibleMembers = filteredMembers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => {
    if (requestedPage > pageCount) {
      update({ page: pageCount === 1 ? undefined : String(pageCount) }, true)
    }
  }, [pageCount, requestedPage, update])

  if (members.length === 0) {
    return (
      <div className="grid gap-4">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{m.empty_no_members()}</EmptyTitle>
            <EmptyDescription>{m.empty_send_invitation()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <div className="relative min-w-0">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) =>
              update({ query: event.target.value || undefined, page: undefined }, true)
            }
            placeholder={m.members_search_placeholder()}
            aria-label={m.members_search_label()}
            className="bg-card pl-9 sm:max-w-md"
          />
        </div>
        <TableViewControls fields={fields} view={table.view} onChange={table.setView} />
      </div>
      {filteredMembers.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{m.members_no_filter_match()}</EmptyTitle>
            <EmptyDescription>{m.members_filter_hint()}</EmptyDescription>
            <Button
              variant="outline"
              onClick={() => {
                update(
                  { query: undefined, tableViews: undefined, page: undefined },
                  true
                )
              }}
            >
              {m.table_view_clear_all()}
            </Button>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ItemGroup className="gap-0">
            {visibleMembers.map((member, index) => (
              <Fragment key={member.id}>
                <Item size="sm" className="flex-nowrap px-0 py-4">
                  <ItemMedia
                    aria-hidden="true"
                    className="grid size-10 place-items-center rounded-md border border-border bg-card text-sm font-medium text-muted-foreground"
                  >
                    {member.name
                      .trim()
                      .split(/\s+/u)
                      .slice(0, 2)
                      .map((part) => part.charAt(0))
                      .join('')
                      .toLocaleUpperCase()}
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <div className="grid min-w-0 gap-0.5">
                      <ItemTitle className="truncate">{member.name}</ItemTitle>
                      <ItemDescription className="line-clamp-none break-all">
                        {member.email}
                      </ItemDescription>
                    </div>
                    {failedRow?.key === member.id ? (
                      <ActionFeedback error={failedRow.message} />
                    ) : null}
                  </ItemContent>
                  <MemberActions
                    member={member}
                    actorUserId={actorUserId}
                    canManage={canManage}
                    canRemove={canRemove}
                    viewer={viewer}
                    changing={changeRole.pendingInput?.userId === member.id}
                    removing={removeMember.pendingInput?.userId === member.id}
                    leaving={leaveWorkspace.pending}
                    leaveArmed={leaveArmed && member.id === actorUserId}
                    onRoleChange={(role) =>
                      void runOnRow(member.id, () =>
                        changeRole.runAsync({ userId: member.id, role })
                      )
                    }
                    onRemove={() => setConfirmingMember(member)}
                    onLeave={() => {
                      setLeaveArmed(false)
                      void runOnRow(actorUserId, () => leaveWorkspace.runAsync())
                    }}
                    onLeaveArm={() => setLeaveArmed(true)}
                    onLeaveCancel={() => setLeaveArmed(false)}
                  />
                </Item>
                {index < visibleMembers.length - 1 ? <Separator /> : null}
              </Fragment>
            ))}
          </ItemGroup>
          {pageCount > 1 ? (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                {m.developer_list_page({ page, pages: pageCount })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={page === 1}
                  onClick={() =>
                    update({ page: page === 2 ? undefined : String(page - 1) })
                  }
                >
                  {m.developer_list_previous()}
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={page === pageCount}
                  onClick={() => update({ page: String(page + 1) })}
                >
                  {m.developer_list_next()}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
      {canManage ? null : (
        <p className="text-xs text-muted-foreground">{m.workspace_role_denied()}</p>
      )}
      <AlertDialog
        open={confirmingMember !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmingMember(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {m.members_remove_title({ name: confirmingMember?.name ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {m.members_remove_description({ name: confirmingMember?.name ?? '' })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeMember.pending}
              onClick={() => {
                const member = confirmingMember
                setConfirmingMember(null)
                if (member !== null) {
                  void runOnRow(member.id, () =>
                    removeMember.runAsync({ userId: member.id })
                  )
                }
              }}
            >
              {removeMember.pending ? <Spinner data-icon="inline-start" /> : null}
              {m.action_confirm_remove()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
