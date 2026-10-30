import { Effect } from 'effect'
import { m } from '@b2b-saas-starter/i18n/messages'
import * as Members from '@/lib/server/workspace-members'
import * as Invitations from '@/lib/server/invitations'
import { viewerCan, workspaceRoles } from '@/lib/permissions'
import { roleLabel, statusLabel } from '@/lib/value-labels'
import { formatTimestampOr } from '@/lib/format-date'
import { EMAIL_PATTERN } from '@/lib/email-pattern'
import { call } from '../server-call'
import { purpose, status, reason } from '../account-admin/notifications'
import { type Model, type Action, type Result, type Message } from './model'
import {
  action,
  actionMenu,
  button,
  feedback,
  heading,
  href,
  link,
  panel,
  query,
  row,
  select,
  tabs,
  tabPanel,
  textarea,
  type H
} from './ui'
import { listControls, paged, pagination } from './table'

export function execute(
  model: Model,
  operation: Extract<
    Action,
    {
      _tag:
        | 'Invite'
        | 'Role'
        | 'RemoveMember'
        | 'Leave'
        | 'CancelInvitation'
        | 'ResendInvitation'
    }
  >
) {
  const workspaceSlug = model.flags.slug
  return Effect.gen(function* () {
    switch (operation._tag) {
      case 'Invite': {
        const addresses = operation.retry
          ? model.members.results.flatMap((r) => (r.ok ? [] : [r.email]))
          : [
              ...new Set(
                model.members.emails
                  .split(/[\n,]+/u)
                  .map((value) => value.trim())
                  .filter(Boolean)
              )
            ]
        const role = operation.retry ? model.members.batchRole : model.members.role
        if (
          !addresses.length ||
          addresses.some((email) => !EMAIL_PATTERN.test(email))
        ) {
          return {
            _tag: 'Invitations',
            results: addresses.length
              ? addresses.map((email) => ({
                  email,
                  ok: false,
                  message: m.invitation_batch_invalid({ emails: email })
                }))
              : [{ email: '', ok: false, message: m.invitation_batch_required() }]
          } satisfies Result
        }
        const results = yield* Effect.forEach(
          addresses,
          (email) =>
            call(
              () =>
                Invitations.sendInvitationServerFn({
                  data: { workspaceSlug, email, role }
                }),
              m.invitation_send_failed()
            ).pipe(
              Effect.map((sent) => ({
                email,
                ok: true,
                message:
                  sent.status === 'failed'
                    ? m.workspace_invitation_created_unsent({ email })
                    : m.invitation_batch_success()
              })),
              Effect.catchTag('RequestFailure', (error) =>
                Effect.succeed({ email, ok: false, message: error.message })
              )
            ),
          { concurrency: 1 }
        )
        return { _tag: 'Invitations', results } satisfies Result
      }
      case 'Role': {
        yield* call(
          () =>
            Members.changeMemberRoleServerFn({
              data: { workspaceSlug, userId: operation.userId, role: operation.role }
            }),
          m.member_role_change_failed()
        )
        const name =
          model.page._tag === 'members'
            ? model.page.data.members.find((member) => member.id === operation.userId)
                ?.name
            : undefined
        return {
          _tag: 'Done',
          notice: name
            ? m.workspace_role_changed_named({ name, role: roleLabel(operation.role) })
            : m.workspace_role_changed({ role: roleLabel(operation.role) })
        } satisfies Result
      }
      case 'RemoveMember': {
        yield* call(
          () =>
            Members.removeMemberServerFn({
              data: { workspaceSlug, userId: operation.userId }
            }),
          m.member_remove_failed()
        )
        const name =
          model.page._tag === 'members'
            ? model.page.data.members.find((member) => member.id === operation.userId)
                ?.name
            : undefined
        return {
          _tag: 'Done',
          notice: name
            ? m.workspace_member_removed_named({ name })
            : m.workspace_member_removed()
        } satisfies Result
      }
      case 'Leave': {
        yield* call(
          () => Members.leaveWorkspaceServerFn({ data: { workspaceSlug } }),
          m.member_leave_failed()
        )
        yield* Effect.sync(() => window.location.assign('/workspaces'))
        break
      }
      case 'CancelInvitation': {
        yield* call(
          () =>
            Invitations.cancelInvitationServerFn({
              data: { workspaceSlug, invitationId: operation.id }
            }),
          m.invitation_cancel_failed()
        )
        const email =
          model.page._tag === 'members'
            ? model.page.data.invitations?.find(
                (invitation) => invitation.id === operation.id
              )?.email
            : undefined
        return {
          _tag: 'Done',
          notice: email
            ? m.workspace_invitation_canceled_named({ email })
            : m.workspace_invitation_canceled()
        } satisfies Result
      }
      case 'ResendInvitation': {
        const sent = yield* call(
          () =>
            Invitations.resendInvitationServerFn({
              data: { workspaceSlug, invitationId: operation.id }
            }),
          m.invitation_send_failed()
        )
        let notice = m.workspace_invitation_created_unsent({
          email: sent.invitation.email
        })
        if (sent.status === 'accepted') {
          notice = m.email_delivery_invitation_accepted({
            email: sent.invitation.email
          })
        }
        if (sent.status === 'logged') {
          notice = m.email_delivery_invitation_logged({ email: sent.invitation.email })
        }
        return { _tag: 'Done', notice } satisfies Result
      }
      default: {
        break
      }
    }
    return { _tag: 'Done', notice: m.common_done() } satisfies Result
  })
}

export function invitationForm(model: Model, h: H) {
  const failed = model.members.results.filter((r) => !r.ok)
  return h.div(
    [h.Class('grid gap-4')],
    [
      textarea(
        h,
        'invitation-emails',
        m.invitation_emails_label(),
        model.members.emails,
        (value) => ({ _tag: 'MemberField', field: 'emails', value }),
        model.pending,
        m.invitation_email_placeholder()
      ),
      h.p([h.Class('text-sm text-muted-foreground')], [m.invitation_emails_hint()]),
      select(
        h,
        m.common_role(),
        model.members.role,
        workspaceRoles.map((role) => [role, roleLabel(role)]),
        (value) => ({ _tag: 'MemberField', field: 'role', value })
      ),
      action(h, model, m.form_send_invitation(), { _tag: 'Invite', retry: false }),
      ...(model.members.results.length
        ? [
            h.p(
              [h.Role('status')],
              [
                m.invitation_batch_summary({
                  sent: model.members.results.length - failed.length,
                  failed: failed.length
                })
              ]
            )
          ]
        : []),
      ...model.members.results.map((result) =>
        h.p(
          [h.Class(result.ok ? 'text-status-ok' : 'text-destructive')],
          [`${result.email}: ${result.message}`]
        )
      ),
      ...(failed.length
        ? [
            action(h, model, m.invitation_retry_failed(), {
              _tag: 'Invite',
              retry: true
            })
          ]
        : []),
      feedback(h, model)
    ]
  )
}

export function view(model: Model, h: H) {
  if (model.page._tag !== 'members') {
    return h.div([], [])
  }
  const data = model.page.data
  const failedMember =
    model.failedAction?._tag === 'Role' || model.failedAction?._tag === 'RemoveMember'
      ? model.failedAction.userId
      : null
  const section = query(model, 'tab') || 'members'
  const fields = [
    { id: 'name', label: m.developer_list_name(), kind: 'text' as const },
    { id: 'email', label: m.provider_email(), kind: 'text' as const },
    {
      id: 'role',
      label: m.common_role(),
      kind: 'select' as const,
      options: workspaceRoles.map((role) => ({ value: role, label: roleLabel(role) }))
    }
  ]
  const rows = paged(
    model,
    'members',
    fields,
    data.members,
    (member, key) => {
      if (key === 'email') {
        return member.email
      }
      if (key === 'role') {
        return member.role
      }
      return member.name
    },
    (member) => `${member.name} ${member.email}`
  )
  const invitationFields = [
    { id: 'email', label: m.form_email(), kind: 'text' as const },
    {
      id: 'role',
      label: m.common_role(),
      kind: 'select' as const,
      options: workspaceRoles.map((role) => ({ value: role, label: roleLabel(role) }))
    },
    { id: 'expiresAt', label: m.token_expires(), kind: 'date' as const },
    {
      id: 'status',
      label: m.common_status(),
      kind: 'select' as const,
      options: ['pending', 'accepted', 'rejected', 'canceled'].map((value) => ({
        value,
        label: statusLabel(value)
      }))
    }
  ]
  const invitations = paged(
    model,
    'invitations',
    invitationFields,
    data.invitations ?? [],
    (invitation, key) => {
      if (key === 'role') {
        return invitation.role
      }
      if (key === 'expiresAt') {
        return invitation.expiresAt
      }
      if (key === 'status') {
        return invitation.status
      }
      return invitation.email
    },
    (invitation) => invitation.email
  )
  return h.div(
    [h.Class('grid gap-6')],
    [
      heading(
        h,
        m.nav_members(),
        m.page_members_description(),
        viewerCan(data.viewer, { invitation: ['create'] })
          ? [button(h, m.form_invite_member(), { _tag: 'Open', dialog: 'invite' })]
          : []
      ),
      ...(viewerCan(data.viewer, { invitation: ['create'] })
        ? []
        : [h.p([], [m.workspace_invite_denied()])]),
      ...(data.seatUsage.overLimit
        ? [
            h.p(
              [h.Role('status')],
              [
                m.members_seat_limit({
                  used: data.seatUsage.used,
                  included: data.seatUsage.included ?? 0
                }),
                link(h, href(model, '/billing'), m.upgrade_plan_to_cover_team())
              ]
            )
          ]
        : []),
      tabs(h, model, [
        ['members', m.nav_members()],
        ...(data.invitations === null
          ? []
          : [['invitations', m.panel_invitations()] as const]),
        ...(data.emailDeliveries === null
          ? []
          : [['delivery', m.email_delivery_title()] as const])
      ]),
      tabPanel(h, section, [
        ...(section === 'members'
          ? [
              ...(viewerCan(data.viewer, { member: ['update'] })
                ? []
                : [h.p([], [m.workspace_role_denied()])]),
              listControls(h, model, 'members', fields, m.members_search_label()),
              h.ul(
                [],
                rows.items.map((member) => {
                  const own = member.id === model.flags.actorUserId
                  const manageable =
                    viewerCan(data.viewer, { member: ['update'] }) &&
                    !own &&
                    (data.viewer?.role === 'owner' || member.role !== 'owner')
                  const membershipActions: Array<{
                    label: string
                    message: Message
                    disabled: boolean
                  }> = []
                  if (own) {
                    membershipActions.push({
                      label: m.action_leave_workspace(),
                      message: {
                        _tag: 'Confirm',
                        action: { _tag: 'Leave' },
                        title: m.action_leave_workspace()
                      },
                      disabled: model.pending
                    })
                  } else if (viewerCan(data.viewer, { member: ['delete'] })) {
                    membershipActions.push({
                      label: m.action_remove(),
                      message: {
                        _tag: 'Confirm',
                        action: { _tag: 'RemoveMember', userId: member.id },
                        title: m.members_remove_title({ name: member.name })
                      },
                      disabled: model.pending
                    })
                  }
                  return row(h, member.name, member.email, [
                    ...(failedMember === member.id ? [feedback(h, model)] : []),
                    h.span([h.Class('text-sm')], [roleLabel(member.role)]),
                    actionMenu(
                      h,
                      `member-actions-${member.id}`,
                      m.members_more_actions({ name: member.name }),
                      [
                        ...(manageable
                          ? workspaceRoles.flatMap((role) => {
                              if (
                                role === member.role ||
                                (data.viewer?.role !== 'owner' && role === 'owner')
                              ) {
                                return []
                              }
                              return [
                                {
                                  label: m.shell_make_role({ role: roleLabel(role) }),
                                  message: {
                                    _tag: 'Perform' as const,
                                    action: {
                                      _tag: 'Role' as const,
                                      userId: member.id,
                                      role
                                    }
                                  },
                                  disabled: model.pending
                                }
                              ]
                            })
                          : []),
                        ...membershipActions
                      ]
                    )
                  ])
                })
              ),
              pagination(h, model, rows.pages),
              ...(rows.items.length
                ? []
                : [
                    h.p(
                      [],
                      [
                        data.members.length
                          ? m.members_no_filter_match()
                          : m.empty_no_members()
                      ]
                    ),
                    h.p([], [m.members_filter_hint()])
                  ])
            ]
          : []),
        ...(section === 'invitations' && data.invitations !== null
          ? [
              h.h2([], [m.panel_invitations()]),
              h.p([], [m.panel_invitations_description()]),
              listControls(
                h,
                model,
                'invitations',
                invitationFields,
                m.developer_list_search_invitations()
              ),
              ...(invitations.items.length === 0 && data.invitations.length > 0
                ? [h.p([], [m.developer_list_no_matching_invitations()])]
                : []),
              ...(data.invitations.length > 0
                ? []
                : [
                    h.p([], [m.empty_no_invitations()]),
                    h.p([], [m.empty_sent_invitations()])
                  ]),
              h.ul(
                [],
                invitations.items.flatMap((invitation) => {
                  return [
                    row(
                      h,
                      invitation.email,
                      `${roleLabel(invitation.role)} · ${statusLabel(invitation.status)} · ${formatTimestampOr(invitation.expiresAt, m.empty_value())}`,
                      [
                        ...(invitation.status === 'pending' &&
                        viewerCan(data.viewer, { invitation: ['cancel'] })
                          ? [
                              action(
                                h,
                                model,
                                m.common_cancel(),
                                { _tag: 'CancelInvitation', id: invitation.id },
                                true
                              )
                            ]
                          : []),
                        ...(invitation.status === 'pending' &&
                        viewerCan(data.viewer, { invitation: ['create'] })
                          ? [
                              action(h, model, m.email_delivery_resend_invitation(), {
                                _tag: 'ResendInvitation',
                                id: invitation.id
                              })
                            ]
                          : [])
                      ]
                    )
                  ]
                })
              ),
              pagination(h, model, invitations.pages)
            ]
          : []),
        ...(section === 'delivery' && data.emailDeliveries !== null
          ? [
              panel(
                h,
                m.email_delivery_title(),
                data.emailDeliveries.map((delivery) =>
                  h.article(
                    [h.Class('grid gap-2 border-b py-4')],
                    [
                      h.p([], [delivery.recipient]),
                      h.p(
                        [],
                        [
                          `${status(delivery.status)} · ${purpose(delivery.purpose)} · ${formatTimestampOr(delivery.createdAt, m.empty_value())}`
                        ]
                      ),
                      ...(delivery.reason ? [h.p([], [reason(delivery.reason)])] : []),
                      h.p(
                        [],
                        [
                          `${m.webhook_attempt_count({ count: delivery.attemptCount })} · ${delivery.uncertain ? m.email_delivery_ambiguous() : ''} ${delivery.unconfirmed ? m.email_delivery_unconfirmed() : ''}`
                        ]
                      )
                    ]
                  )
                )
              )
            ]
          : []),
        ...(failedMember === null ? [feedback(h, model)] : [])
      ])
    ]
  )
}
