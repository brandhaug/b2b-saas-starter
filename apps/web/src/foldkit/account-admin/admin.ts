import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import * as Responses from '@/http/contracts/admin'
import { loadSystemEmailDeliveryServerFnResponse } from '@/http/contracts/email-delivery'
import * as Api from '@/lib/server/admin'
import { formatDateTime } from '@/lib/format-date'
import { roleLabel, statusLabel } from '@/lib/value-labels'
import { failedDeliveryFields } from '@/lib/failed-delivery-fields'
import { parseTableView, serializeTableView } from '@/lib/table-view'
import { m } from '@b2b-saas-starter/i18n/messages'
import { call } from '../server-call'
import { inputClass } from '../shared/view'
import { button, confirmation, feedback, field, heading, panel, text } from './ui'
import { deliveries, deliveryColumns } from './notifications'
import * as Table from './table'

export const Flags = Schema.Struct({
  users: Responses.listSystemUsersServerFnResponse,
  events: Responses.loadAdminAuditEventsServerFnResponse,
  workspaces: Responses.listAdminWorkspacesServerFnResponse,
  failedDeliveries: Responses.loadFailedDeliveriesServerFnResponse,
  emailDeliveries: loadSystemEmailDeliveryServerFnResponse,
  search: Schema.String
})
export type Flags = typeof Flags.Type
const Role = Schema.Literals(['owner', 'admin', 'member'])
const Operation = Schema.TaggedUnion({
  Ban: { id: Schema.String, email: Schema.String, banned: Schema.Boolean },
  Impersonate: { id: Schema.String, email: Schema.String, name: Schema.String },
  Memberships: {},
  Role: { workspaceId: Schema.String, role: Role },
  Suspend: { workspaceId: Schema.String, active: Schema.Boolean },
  Replay: { id: Schema.String }
})
type Operation = typeof Operation.Type
const Reason = Schema.Struct({ internal: Schema.String, customer: Schema.String })
export const Model = Schema.Struct({
  flags: Flags,
  ready: Schema.Boolean,
  pending: Schema.Boolean,
  selectedUser: Schema.String,
  memberships: Schema.NullOr(Responses.listUserWorkspacesServerFnResponse),
  confirming: Schema.NullOr(Operation),
  reasons: Schema.Record(Schema.String, Reason),
  replayed: Schema.Array(Schema.String),
  error: Schema.NullOr(Schema.String),
  notice: Schema.NullOr(Schema.String),
  usersTable: Table.Model,
  eventsTable: Table.Model,
  emailTable: Table.Model,
  failedTable: Table.Model
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: {},
  Selected: { id: Schema.String },
  Reason: {
    id: Schema.String,
    field: Schema.Literals(['internal', 'customer']),
    value: Schema.String
  },
  Requested: { operation: Operation },
  Confirmed: {},
  Cancelled: {},
  Failed: { error: Schema.String },
  Users: { users: Responses.listSystemUsersServerFnResponse },
  Memberships: { rows: Responses.listUserWorkspacesServerFnResponse },
  Workspaces: { rows: Responses.listAdminWorkspacesServerFnResponse },
  Replayed: {
    id: Schema.String,
    result: Responses.replayFailedDeliveryServerFnResponse
  },
  Completed: {},
  Table: {
    table: Schema.Literals(['usersTable', 'eventsTable', 'emailTable', 'failedTable']),
    message: Table.Message
  },
  Failures: { page: Responses.loadFailedDeliveriesServerFnResponse },
  LoadFailures: { cursor: Schema.NullOr(Schema.String) }
})
export type Message = typeof Message.Type
const { cases: Msg } = Message
const Execute = Command.define('SystemAdmin.Execute', {
  args: { model: Model, operation: Operation },
  messages: [
    Msg.Users,
    Msg.Memberships,
    Msg.Workspaces,
    Msg.Replayed,
    Msg.Completed,
    Msg.Failed
  ],
  execute: ({ model, operation }) =>
    Effect.gen(function* () {
      switch (operation._tag) {
        case 'Ban': {
          yield* call(
            () =>
              operation.banned
                ? Api.unbanSystemUserServerFn({ data: { userId: operation.id } })
                : Api.banSystemUserServerFn({ data: { userId: operation.id } }),
            m.admin_ban_failed({
              action: operation.banned ? m.admin_user_unban() : m.admin_user_ban()
            })
          )
          return Msg.Users.make({
            users: yield* call(
              () => Api.listSystemUsersServerFn(),
              m.shell_save_error()
            )
          })
        }
        case 'Impersonate': {
          yield* call(
            () => Api.impersonateUserServerFn({ data: { userId: operation.id } }),
            m.impersonation_failed()
          )
          yield* Effect.sync(() => window.location.assign('/workspaces'))
          return Msg.Completed.make({})
        }
        case 'Memberships': {
          return Msg.Memberships.make({
            rows: yield* call(
              () =>
                Api.listUserWorkspacesServerFn({
                  data: { userId: model.selectedUser }
                }),
              m.load_workspaces_failed()
            )
          })
        }
        case 'Role': {
          yield* call(
            () =>
              Api.changeUserWorkspaceRoleServerFn({
                data: {
                  userId: model.selectedUser,
                  workspaceId: operation.workspaceId,
                  role: operation.role
                }
              }),
            m.role_change_failed()
          )
          return Msg.Memberships.make({
            rows: yield* call(
              () =>
                Api.listUserWorkspacesServerFn({
                  data: { userId: model.selectedUser }
                }),
              m.load_workspaces_failed()
            )
          })
        }
        case 'Suspend': {
          const reason = model.reasons[operation.workspaceId] ?? {
            internal: '',
            customer: ''
          }
          const base: Api.WorkspaceSuspensionInput = {
            workspaceId: operation.workspaceId,
            action: operation.active ? 'suspend' : 'unsuspend',
            internalReason: reason.internal.trim()
          }
          const data = operation.active
            ? { ...base, customerExplanation: reason.customer.trim() }
            : base
          yield* call(
            () =>
              Api.transitionAdminWorkspaceServerFn({
                data
              }),
            operation.active
              ? m.admin_workspace_suspend_failed()
              : m.admin_workspace_reactivate_failed()
          )
          return Msg.Workspaces.make({
            rows: yield* call(
              () => Api.listAdminWorkspacesServerFn(),
              m.load_workspaces_failed()
            )
          })
        }
        case 'Replay': {
          return Msg.Replayed.make({
            id: operation.id,
            result: yield* call(
              () =>
                Api.replayFailedDeliveryServerFn({
                  data: { deliveryId: operation.id }
                }),
              `${m.replay_failed()} ${m.replay_pending_copy()}`
            )
          })
        }
      }
    }).pipe(
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Msg.Failed.make({ error: error.message }))
      )
    )
})
const LoadFailures = Command.define('SystemAdmin.Failures', {
  args: { model: Model, cursor: Schema.NullOr(Schema.String) },
  messages: [Msg.Failures, Msg.Failed],
  execute: ({ model, cursor }) =>
    Effect.gen(function* () {
      const serializedView = serializeTableView(model.failedTable.view)
      let data: Parameters<typeof Api.loadFailedDeliveriesServerFn>[0]['data'] = {}
      if (serializedView) {
        data = { ...data, view: serializedView }
      }
      if (cursor) {
        data = { ...data, cursor }
      }
      const page = yield* call(
        () =>
          Api.loadFailedDeliveriesServerFn({
            data
          }),
        m.replay_failed()
      )
      yield* Effect.sync(() => {
        const url = new URL(window.location.href)
        if (serializedView) {
          url.searchParams.set('failureView', serializedView)
        } else {
          url.searchParams.delete('failureView')
        }
        if (cursor) {
          url.searchParams.set('failureCursor', cursor)
        } else {
          url.searchParams.delete('failureCursor')
        }
        window.history.pushState(null, '', url)
      })
      return Msg.Failures.make({ page })
    }).pipe(
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Msg.Failed.make({ error: error.message }))
      )
    )
})
type User = (typeof Responses.listSystemUsersServerFnResponse.Type)[number]
type Event = (typeof Responses.loadAdminAuditEventsServerFnResponse.Type)[number]
function userColumns(): ReadonlyArray<Table.Column<User, Message>> {
  return [
    { id: 'name', label: m.admin_name(), kind: 'text', value: (row) => row.name },
    { id: 'email', label: m.admin_email(), kind: 'text', value: (row) => row.email },
    {
      id: 'role',
      label: m.admin_system_role(),
      kind: 'select',
      value: (row) => row.role,
      options: ['admin', 'user'].map((value) => ({ value, label: roleLabel(value) })),
      cell: (row, h) =>
        h.span([h.Class('border border-border px-2 py-0.5')], [roleLabel(row.role)])
    },
    {
      id: 'banned',
      label: m.status(),
      kind: 'select',
      value: (row) => row.banned,
      options: [
        { value: 'true', label: m.user_banned() },
        { value: 'false', label: m.user_active() }
      ],
      cell: (row, h) =>
        h.span(
          [h.Class(row.banned ? 'text-destructive' : 'text-status-ok')],
          [row.banned ? m.user_banned() : m.user_active()]
        )
    }
  ]
}
function eventColumns(): ReadonlyArray<Table.Column<Event, Message>> {
  return [
    {
      id: 'eventType',
      label: m.event_label(),
      kind: 'text',
      value: (row) => row.eventType
    },
    {
      id: 'targetType',
      label: m.target_label(),
      kind: 'text',
      value: (row) => row.targetType
    },
    {
      id: 'actor',
      label: m.actor_label(),
      kind: 'text',
      value: (row) => row.actor,
      cell: (row, h) => h.span([], [`${row.actor} · ${row.actorType}`])
    },
    {
      id: 'createdAt',
      label: m.admin_created(),
      kind: 'date',
      value: (row) => row.createdAt,
      cell: (row, h) =>
        h.span([h.Class('font-mono tabular-nums')], [formatDateTime(row.createdAt)])
    }
  ]
}
export function init(flags: Flags): Update.Return<Model, Message> {
  return {
    model: {
      flags,
      ready: false,
      pending: false,
      selectedUser: flags.users[0]?.id ?? '',
      memberships: null,
      confirming: null,
      reasons: {},
      replayed: [],
      error: null,
      notice: null,
      usersTable: Table.init('admin-users', flags.search, userColumns()),
      eventsTable: Table.init('admin-audit', flags.search, eventColumns()),
      emailTable: Table.init('email-deliveries', flags.search, deliveryColumns()),
      failedTable: {
        ...Table.init('admin-failures', '', failedDeliveryFields()),
        view: parseTableView(
          new URLSearchParams(flags.search).get('failureView') ?? undefined,
          failedDeliveryFields()
        )
      }
    }
  }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Ready': {
      return { model: { ...model, ready: true } }
    }
    case 'Selected': {
      return model.pending
        ? { model }
        : update(
            { ...model, selectedUser: message.id, memberships: null },
            { _tag: 'Requested', operation: { _tag: 'Memberships' } }
          )
    }
    case 'Reason': {
      return {
        model: {
          ...model,
          reasons: {
            ...model.reasons,
            [message.id]: {
              ...(model.reasons[message.id] ?? { internal: '', customer: '' }),
              [message.field]: message.value
            }
          }
        }
      }
    }
    case 'Cancelled': {
      return model.pending ? { model } : { model: { ...model, confirming: null } }
    }
    case 'Requested': {
      if (!model.ready || model.pending) {
        return { model }
      }
      if (
        message.operation._tag === 'Ban' ||
        message.operation._tag === 'Impersonate'
      ) {
        return { model: { ...model, confirming: message.operation, error: null } }
      }
      return {
        model: { ...model, pending: true, error: null, notice: null },
        commands: [Execute({ model, operation: message.operation })]
      }
    }
    case 'Confirmed': {
      return model.pending || !model.confirming
        ? { model }
        : {
            model: { ...model, pending: true, error: null },
            commands: [Execute({ model, operation: model.confirming })]
          }
    }
    case 'Failed': {
      return { model: { ...model, pending: false, error: message.error } }
    }
    case 'Users': {
      return {
        model: {
          ...model,
          pending: false,
          confirming: null,
          flags: { ...model.flags, users: message.users }
        }
      }
    }
    case 'Memberships': {
      return { model: { ...model, pending: false, memberships: message.rows } }
    }
    case 'Workspaces': {
      return {
        model: {
          ...model,
          pending: false,
          flags: { ...model.flags, workspaces: message.rows }
        }
      }
    }
    case 'Replayed': {
      return {
        model: {
          ...model,
          pending: false,
          notice:
            message.result.status === 'refused'
              ? message.result.reason
              : m.replay_queued({ id: message.result.deliveryId }),
          replayed:
            message.result.status === 'queued'
              ? [...model.replayed, message.id]
              : model.replayed
        }
      }
    }
    case 'Completed': {
      return { model: { ...model, pending: false, confirming: null } }
    }
    case 'LoadFailures': {
      return model.pending
        ? { model }
        : {
            model: { ...model, pending: true },
            commands: [LoadFailures({ model, cursor: message.cursor })]
          }
    }
    case 'Failures': {
      return {
        model: {
          ...model,
          pending: false,
          flags: { ...model.flags, failedDeliveries: message.page }
        }
      }
    }
    case 'Table': {
      if (message.table === 'failedTable' && model.pending) {
        return { model }
      }
      const result = Table.update(model[message.table], message.message)
      const next = { ...model, [message.table]: result.model }
      if (message.table === 'failedTable') {
        if ((result.commands ?? []).length === 0) {
          return { model: next }
        }
        return {
          model: { ...next, pending: true },
          commands: [LoadFailures({ model: next, cursor: null })]
        }
      }
      return {
        model: next,
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, (child): Message => ({
            _tag: 'Table',
            table: message.table,
            message: child
          }))
        )
      }
    }
  }
}
function request(operation: Operation): Message {
  return { _tag: 'Requested', operation }
}
export function view(model: Model, h: HtmlBuilder<Message>): Html {
  const disabled = !model.ready || model.pending
  const content: Array<Html> = [
    heading(h, m.nav_system_admin(), m.page_admin_description()),
    feedback(h, model.error, model.notice)
  ]
  content.push(
    panel(h, m.panel_users(), '', [
      Table.view(
        model.usersTable,
        h,
        (message): Message => ({ _tag: 'Table', table: 'usersTable', message }),
        model.flags.users,
        userColumns(),
        m.admin_system_users(),
        m.common_no_system_users(),
        5,
        (user) =>
          h.div(
            [h.Class('flex gap-1')],
            [
              ...(user.role === 'admin'
                ? []
                : [
                    button(
                      h,
                      m.impersonate_action(),
                      request({
                        _tag: 'Impersonate',
                        id: user.id,
                        email: user.email,
                        name: user.name
                      }),
                      disabled,
                      m.impersonate_title({ email: user.email })
                    )
                  ]),
              button(
                h,
                user.banned ? m.admin_user_unban() : m.admin_user_ban(),
                request({
                  _tag: 'Ban',
                  id: user.id,
                  email: user.email,
                  banned: user.banned
                }),
                disabled,
                `${user.banned ? m.admin_user_unban() : m.admin_user_ban()} ${user.email}`
              )
            ]
          )
      ),
      h.div(
        [h.Class('grid gap-3 bg-muted p-3')],
        [
          text(h, m.workspace_roles()),
          h.select(
            [
              h.AriaLabel(m.select_user()),
              h.Class(inputClass),
              h.Value(model.selectedUser),
              h.Disabled(disabled),
              h.OnChange((id) => ({ _tag: 'Selected', id }))
            ],
            model.flags.users.map((user) =>
              h.option([h.Value(user.id)], [`${user.name} (${user.email})`])
            )
          ),
          button(
            h,
            m.admin_load_workspaces(),
            request({ _tag: 'Memberships' }),
            disabled || !model.selectedUser
          ),
          ...(model.memberships?.length === 0
            ? [
                text(
                  h,
                  m.admin_no_workspace_memberships({
                    name:
                      model.flags.users.find((row) => row.id === model.selectedUser)
                        ?.name ?? ''
                  })
                )
              ]
            : []),
          ...(model.memberships ?? []).map(({ workspace, member }) =>
            h.div(
              [h.Class('flex flex-wrap items-center justify-between gap-3')],
              [
                text(h, workspace.name),
                h.div(
                  [h.Class('flex flex-wrap gap-2')],
                  [
                    text(h, roleLabel(member.role)),
                    ...(['owner', 'admin', 'member'] as const)
                      .filter((role) => role !== member.role)
                      .map((role) =>
                        button(
                          h,
                          roleLabel(role),
                          request({ _tag: 'Role', workspaceId: workspace.id, role }),
                          disabled,
                          m.shell_workspace_role({
                            workspace: workspace.name,
                            role: roleLabel(role)
                          })
                        )
                      )
                  ]
                )
              ]
            )
          )
        ]
      )
    ]),
    panel(
      h,
      m.admin_workspace_lifecycle(),
      m.admin_workspace_lifecycle_description(),
      model.flags.workspaces.map((workspace) => {
        const active = workspace.suspension.status === 'active'
        const reason = model.reasons[workspace.id] ?? { internal: '', customer: '' }
        return h.div(
          [h.Class('grid gap-4 border border-border p-4')],
          [
            h.h3([h.Class('text-sm font-semibold')], [workspace.name]),
            text(
              h,
              active ? m.admin_workspace_active() : m.admin_workspace_suspended()
            ),
            h.div(
              [h.Class('grid gap-3 sm:grid-cols-2')],
              [
                field(
                  h,
                  `${workspace.id}-internal-reason`,
                  m.admin_workspace_internal_reason(),
                  reason.internal,
                  (value): Message => ({
                    _tag: 'Reason',
                    id: workspace.id,
                    field: 'internal',
                    value
                  }),
                  'text',
                  true,
                  m.admin_workspace_internal_reason_placeholder()
                ),
                ...(active
                  ? [
                      field(
                        h,
                        `${workspace.id}-customer-explanation`,
                        m.admin_workspace_customer_explanation(),
                        reason.customer,
                        (value): Message => ({
                          _tag: 'Reason',
                          id: workspace.id,
                          field: 'customer',
                          value
                        }),
                        'text',
                        true,
                        m.admin_workspace_customer_explanation_placeholder()
                      )
                    ]
                  : [])
              ]
            ),
            text(h, m.admin_workspace_internal_reason_hint()),
            ...(active
              ? [text(h, m.admin_workspace_customer_explanation_hint())]
              : [
                  text(
                    h,
                    m.admin_workspace_suspended_since({
                      date: workspace.suspension.changedAt ?? m.common_unknown()
                    })
                  )
                ]),
            button(
              h,
              active ? m.admin_workspace_suspend() : m.admin_workspace_reactivate(),
              request({ _tag: 'Suspend', workspaceId: workspace.id, active }),
              disabled || !reason.internal.trim() || (active && !reason.customer.trim())
            )
          ]
        )
      })
    )
  )
  type Failed =
    (typeof Responses.loadFailedDeliveriesServerFnResponse.Type.items)[number]
  const failureColumns: ReadonlyArray<Table.Column<Failed, Message>> = [
    {
      id: 'endpointUrl',
      label: m.endpoint_url(),
      kind: 'text',
      value: (row) => row.endpointUrl,
      cell: (row, builder) =>
        builder.div(
          [builder.Class('max-w-72 break-all')],
          [
            text(builder, row.endpointUrl),
            ...(row.endpointEnabled
              ? []
              : [
                  text(
                    builder,
                    `${m.delivery_endpoint_disabled({ count: row.endpointConsecutiveFailures })} ${row.endpointFailureLimitReached ? m.delivery_auto_disable_threshold() : ''} ${m.delivery_reenable_before_replay()}`
                  )
                ])
          ]
        )
    },
    {
      id: 'workspace',
      label: m.common_workspaces(),
      kind: 'text',
      value: (row) => row.workspace.name
    },
    {
      id: 'eventType',
      label: m.event_type_label(),
      kind: 'text',
      value: (row) => row.eventType
    },
    {
      id: 'status',
      label: m.common_status(),
      kind: 'select',
      options: [
        { value: 'dead_lettered', label: statusLabel('dead_lettered') },
        { value: 'failed_permanent', label: statusLabel('failed_permanent') }
      ],
      value: (row) => row.status,
      cell: (row, builder) => text(builder, statusLabel(row.status))
    },
    {
      id: 'attempts',
      label: m.attempts_label(),
      kind: 'number',
      value: (row) => row.attempts
    },
    {
      id: 'lastAttemptAt',
      label: m.last_attempt_label(),
      kind: 'date',
      value: (row) => row.lastAttemptAt,
      cell: (row, builder) =>
        text(
          builder,
          row.lastAttemptAt ? formatDateTime(row.lastAttemptAt) : m.not_recorded()
        )
    }
  ]
  content.push(
    panel(h, m.failed_webhook_deliveries(), m.failed_webhook_deliveries_description(), [
      h.fieldset(
        [h.Disabled(disabled), h.Class('min-w-0')],
        [
          Table.view(
            model.failedTable,
            h,
            (message): Message => ({ _tag: 'Table', table: 'failedTable', message }),
            model.flags.failedDeliveries.items,
            failureColumns,
            m.failed_webhook_deliveries(),
            m.no_terminal_webhook_failures(),
            100,
            (row) =>
              button(
                h,
                m.replay_action(),
                request({ _tag: 'Replay', id: row.id }),
                disabled || model.replayed.includes(row.id),
                m.replay_named({ id: row.id })
              ),
            true
          )
        ]
      ),
      h.div(
        [h.Class('flex flex-wrap gap-2')],
        [
          button(
            h,
            m.refresh_newest(),
            { _tag: 'LoadFailures', cursor: null },
            disabled
          ),
          button(
            h,
            m.older_failures(),
            { _tag: 'LoadFailures', cursor: model.flags.failedDeliveries.nextCursor },
            disabled || model.flags.failedDeliveries.nextCursor === null
          )
        ]
      )
    ]),
    deliveries(
      h,
      model.emailTable,
      model.flags.emailDeliveries,
      (message): Message => ({
        _tag: 'Table',
        table: 'emailTable',
        message
      })
    ),
    panel(h, m.panel_audit_events(), '', [
      Table.view(
        model.eventsTable,
        h,
        (message): Message => ({ _tag: 'Table', table: 'eventsTable', message }),
        model.flags.events,
        eventColumns(),
        m.admin_audit_events(),
        m.common_no_audit_events(),
        5
      )
    ])
  )
  if (model.confirming) {
    const op = model.confirming
    if (op._tag === 'Ban') {
      const verb = op.banned ? m.admin_user_unban() : m.admin_user_ban()
      content.push(
        confirmation(
          h,
          m.admin_user_ban_title({ action: verb, email: op.email }),
          op.banned ? m.admin_user_unban_description() : m.admin_user_ban_description(),
          { _tag: 'Confirmed' },
          { _tag: 'Cancelled' },
          model.pending,
          model.error,
          verb
        )
      )
    }
    if (op._tag === 'Impersonate') {
      content.push(
        confirmation(
          h,
          m.impersonate_title({ email: op.email }),
          m.impersonate_description({ name: op.name }),
          { _tag: 'Confirmed' },
          { _tag: 'Cancelled' },
          model.pending,
          model.error,
          m.impersonate_action()
        )
      )
    }
  }
  return h.div([h.Class('grid gap-6')], content)
}
