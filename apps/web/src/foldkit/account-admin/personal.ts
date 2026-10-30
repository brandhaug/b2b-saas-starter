import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { type HtmlBuilder, type Html } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import { setLocale } from '@b2b-saas-starter/i18n/runtime'
import {
  loadAccountPageServerFnResponse,
  exportPersonalDataServerFnResponse
} from '@/http/contracts/account'
import { loadMcpClientConnectionsServerFnResponse } from '@/http/contracts/mcp-clients'
import { loadOwnedConversationsServerFnResponse } from '@/http/contracts/account-conversations'
import {
  deleteAccountServerFn,
  exportPersonalDataServerFn,
  downloadPersonalDataServerFn
} from '@/lib/server/account'
import { deleteOwnedConversationServerFn } from '@/lib/server/account-conversations'
import { revokeMcpClientServerFn } from '@/lib/server/mcp-clients'
import { setLocalePreferencesServerFn } from '@/lib/server/account-preferences'
import { formatTimestamp } from '@/lib/format-date'
import { call } from '../server-call'
import { describeDeleteFailure } from '@/lib/delete-account-failure'
import { LocalizedError } from '@/lib/localized-error'
import { UiError } from '@/lib/ui-error'
import { link, inputClass } from '../shared/view'
import { button, confirmation, feedback, field, form, panel, text } from './ui'

export const Flags = Schema.Struct({
  account: Schema.NullOr(loadAccountPageServerFnResponse),
  connections: loadMcpClientConnectionsServerFnResponse,
  conversations: Schema.NullOr(loadOwnedConversationsServerFnResponse),
  impersonating: Schema.Boolean,
  locale: Schema.Literals(['en', 'nb']),
  timeZone: Schema.String
})
export type Flags = typeof Flags.Type
const Operation = Schema.TaggedUnion({
  Export: {},
  Download: {},
  DeleteAccount: {},
  DeleteConversation: { id: Schema.String },
  RevokeClient: { id: Schema.String, name: Schema.String, workspace: Schema.String },
  Preferences: {}
})
type Operation = typeof Operation.Type
export const Model = Schema.Struct({
  flags: Flags,
  ready: Schema.Boolean,
  pending: Schema.Boolean,
  password: Schema.String,
  locale: Schema.Literals(['en', 'nb']),
  timeZone: Schema.String,
  exported: Schema.NullOr(exportPersonalDataServerFnResponse),
  confirming: Schema.NullOr(Operation),
  removedConversations: Schema.Array(Schema.String),
  revokedClients: Schema.Array(Schema.String),
  error: Schema.NullOr(Schema.String)
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: {},
  PasswordChanged: { value: Schema.String },
  LocaleChanged: { value: Schema.Literals(['en', 'nb']) },
  TimeZoneChanged: { value: Schema.String },
  Requested: { operation: Operation },
  Confirmed: {},
  Cancelled: {},
  Failed: { error: Schema.String },
  Exported: { value: exportPersonalDataServerFnResponse },
  Completed: { operation: Operation }
})
export type Message = typeof Message.Type
const { cases: Msg } = Message
const Execute = Command.define('AccountPersonal.Execute', {
  args: { model: Model, operation: Operation },
  messages: [Msg.Completed, Msg.Failed, Msg.Exported],
  execute: ({ model, operation }) =>
    Effect.gen(function* () {
      switch (operation._tag) {
        case 'Export': {
          return Msg.Exported.make({
            value: yield* call(
              () => exportPersonalDataServerFn(),
              m.personal_data_export_request_failed()
            )
          })
        }
        case 'Download': {
          const exported = model.exported
          if (exported === null) {
            return Msg.Completed.make({ operation })
          }
          const file = yield* call(
            () => downloadPersonalDataServerFn({ data: { exportId: exported.id } }),
            m.personal_data_export_download_failed()
          )
          yield* Effect.sync(() => {
            const url = URL.createObjectURL(
              new Blob([file.json], { type: 'application/json' })
            )
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = file.fileName
            anchor.click()
            URL.revokeObjectURL(url)
          })
          break
        }
        case 'DeleteAccount': {
          yield* call(
            () =>
              deleteAccountServerFn({ data: { password: model.password } }).catch(
                // Preserve typed HTTP failures for the shared verification policy.
                // oxlint-disable-next-line anti-slop/no-unknown-parameters -- rejected transport values are decoded by describeDeleteFailure.
                (error: unknown) => {
                  // oxlint-disable-next-line effect/noThrowStatement -- promise adapter rethrows typed HTTP errors or locally mapped copy.
                  throw error instanceof UiError
                    ? error
                    : new LocalizedError(describeDeleteFailure(error))
                }
              ),
            m.delete_account_failed()
          )
          yield* Effect.sync(() => window.location.assign('/sign-in'))
          break
        }
        case 'DeleteConversation': {
          const result = yield* call(
            () =>
              deleteOwnedConversationServerFn({
                data: { conversationId: operation.id }
              }),
            m.assistant_conversations_delete_description()
          )
          if (!result.ok) {
            return Msg.Failed.make({ error: result.message })
          }
          break
        }
        case 'RevokeClient': {
          yield* call(
            () => revokeMcpClientServerFn({ data: { connectionId: operation.id } }),
            m.mcp_connection_revoke_failed()
          )
          break
        }
        case 'Preferences': {
          yield* call(
            () =>
              setLocalePreferencesServerFn({
                data: { locale: model.locale, timeZone: model.timeZone }
              }),
            m.shell_save_error()
          )
          yield* Effect.promise(async () => {
            if (model.locale === model.flags.locale) {
              window.location.reload()
            } else {
              await setLocale(model.locale)
            }
          })
          break
        }
      }
      return Msg.Completed.make({ operation })
    }).pipe(
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Msg.Failed.make({ error: error.message }))
      )
    )
})
export function init(flags: Flags): Update.Return<Model, Message> {
  return {
    model: {
      flags,
      ready: false,
      pending: false,
      password: '',
      locale: flags.locale,
      timeZone: flags.timeZone,
      exported: null,
      confirming: null,
      removedConversations: [],
      revokedClients: [],
      error: null
    }
  }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Ready': {
      return { model: { ...model, ready: true } }
    }
    case 'PasswordChanged': {
      return { model: { ...model, password: message.value } }
    }
    case 'LocaleChanged': {
      return { model: { ...model, locale: message.value } }
    }
    case 'TimeZoneChanged': {
      return { model: { ...model, timeZone: message.value } }
    }
    case 'Cancelled': {
      return model.pending ? { model } : { model: { ...model, confirming: null } }
    }
    case 'Requested': {
      if (!model.ready || model.pending) {
        return { model }
      }
      if (
        model.flags.impersonating &&
        ['Export', 'Download', 'DeleteAccount'].includes(message.operation._tag)
      ) {
        return { model }
      }
      if (
        message.operation._tag === 'DeleteAccount' &&
        !model.flags.account?.deletionPlan.canDelete
      ) {
        return { model }
      }
      if (
        ['DeleteAccount', 'DeleteConversation', 'RevokeClient'].includes(
          message.operation._tag
        )
      ) {
        return { model: { ...model, confirming: message.operation, error: null } }
      }
      return {
        model: { ...model, pending: true, error: null },
        commands: [Execute({ model, operation: message.operation })]
      }
    }
    case 'Confirmed': {
      return !model.confirming || model.pending
        ? { model }
        : {
            model: { ...model, pending: true, error: null },
            commands: [Execute({ model, operation: model.confirming })]
          }
    }
    case 'Failed': {
      return { model: { ...model, pending: false, password: '', error: message.error } }
    }
    case 'Exported': {
      return { model: { ...model, pending: false, exported: message.value } }
    }
    case 'Completed': {
      return {
        model: {
          ...model,
          pending: false,
          confirming: null,
          password: '',
          removedConversations:
            message.operation._tag === 'DeleteConversation'
              ? [...model.removedConversations, message.operation.id]
              : model.removedConversations,
          revokedClients:
            message.operation._tag === 'RevokeClient'
              ? [...model.revokedClients, message.operation.id]
              : model.revokedClients
        }
      }
    }
  }
}
function request(operation: Operation): Message {
  return { _tag: 'Requested', operation }
}
export function view(
  model: Model,
  h: HtmlBuilder<Message>,
  region: 'all' | 'data' | 'deletion-connections' = 'all'
): Html {
  const removedConversations = new Set(model.removedConversations)
  const revokedClients = new Set(model.revokedClients)
  const disabled = !model.ready || model.pending
  const sections: Array<Html> = [feedback(h, model.error)]
  sections.push(
    panel(h, m.shell_preferences(), m.shell_preferences_description(), [
      form(
        h,
        request({ _tag: 'Preferences' }),
        m.shell_save(),
        model.pending,
        model.ready,
        [
          h.div(
            [h.Class('grid gap-2')],
            [
              h.label([h.For('account-locale')], [m.shell_language()]),
              h.select(
                [
                  h.Id('account-locale'),
                  h.Class(inputClass),
                  h.Value(model.locale),
                  h.OnChange((value) => ({
                    _tag: 'LocaleChanged',
                    value: value === 'nb' ? 'nb' : 'en'
                  }))
                ],
                [
                  h.option([h.Value('en')], ['English']),
                  h.option([h.Value('nb')], ['Norsk'])
                ]
              )
            ]
          ),
          field(
            h,
            'timeZone',
            m.shell_time_zone(),
            model.timeZone,
            (value): Message => ({
              _tag: 'TimeZoneChanged',
              value
            })
          ),
          text(h, m.shell_time_zone_hint())
        ]
      )
    ]),
    panel(
      h,
      m.panel_personal_data(),
      m.panel_personal_data_description(),
      model.flags.impersonating
        ? [text(h, m.shell_impersonated_personal_data())]
        : [
            h.div(
              [h.Class('flex flex-wrap gap-3')],
              [
                button(
                  h,
                  model.exported
                    ? m.personal_data_request_new_export()
                    : m.personal_data_request_export(),
                  request({ _tag: 'Export' }),
                  disabled
                ),
                ...(model.exported
                  ? [
                      button(
                        h,
                        m.personal_data_download_export(),
                        request({ _tag: 'Download' }),
                        disabled
                      )
                    ]
                  : [])
              ]
            ),
            ...(model.exported
              ? [
                  text(
                    h,
                    m.personal_data_available_until({
                      time: formatTimestamp(model.exported.expiresAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                      })
                    })
                  )
                ]
              : [])
          ]
    )
  )
  const conversations = model.flags.conversations
  if (conversations) {
    const rows = conversations.ok
      ? conversations.value.filter((row) => !removedConversations.has(row.id))
      : []
    sections.push(
      panel(
        h,
        m.assistant_conversations_title(),
        m.assistant_conversations_account_description(),
        [
          ...(conversations.ok ? [] : [feedback(h, conversations.message)]),
          ...(rows.length ? [] : [text(h, m.assistant_conversations_empty())]),
          h.ul(
            [h.Class('grid gap-3')],
            rows.map((row) =>
              h.li(
                [h.Class('flex flex-wrap items-center justify-between gap-3')],
                [
                  h.div(
                    [h.Class('min-w-0')],
                    [
                      h.p([h.Class('break-all font-mono text-sm')], [row.id]),
                      text(h, formatTimestamp(row.createdAt, { dateStyle: 'short' }))
                    ]
                  ),
                  button(
                    h,
                    m.assistant_conversations_delete(),
                    request({ _tag: 'DeleteConversation', id: row.id }),
                    disabled
                  )
                ]
              )
            )
          )
        ]
      )
    )
  }
  const plan = model.flags.account?.deletionPlan
  const accountActions: Array<Html> = []
  if (plan) {
    const children: Array<Html> = []
    if (model.flags.impersonating) {
      children.push(text(h, m.shell_impersonated_deletion()))
    } else if (plan.canDelete) {
      children.push(text(h, m.delete_account_permanent()))
      const leaving = plan.steps.filter((step) => step.action === 'leave')
      const deleting = plan.steps.filter((step) => step.action === 'delete_workspace')
      if (leaving.length) {
        children.push(
          text(
            h,
            m.account_leave_workspaces({
              count: leaving.length,
              names: leaving.map((step) => step.workspace.name).join(', ')
            })
          )
        )
      }
      if (deleting.length) {
        children.push(
          text(
            h,
            m.account_delete_workspaces({
              count: deleting.length,
              names: deleting.map((step) => step.workspace.name).join(', ')
            })
          )
        )
      }
      if (!leaving.length && !deleting.length) {
        children.push(text(h, m.workspace_delete_none_affected()))
      }
      children.push(
        form(
          h,
          request({ _tag: 'DeleteAccount' }),
          m.panel_delete_account(),
          model.pending,
          model.ready,
          [
            field(
              h,
              'delete-account-password',
              m.form_password(),
              model.password,
              (value): Message => ({ _tag: 'PasswordChanged', value }),
              'password'
            )
          ]
        )
      )
    } else {
      const owners = plan.steps.filter((step) => step.action === 'blocked_sole_owner')
      if (owners.length) {
        children.push(text(h, m.account_only_owner_warning({ count: owners.length })))
      }
      for (const step of plan.steps) {
        const name = step.workspace.name
        if (step.action === 'blocked_sole_owner') {
          children.push(link(h, `/workspaces/${step.workspace.slug}/members`, name))
        }
        if (step.action === 'blocked_suspended_workspace') {
          children.push(
            text(h, m.account_suspended_workspace_warning({ workspace: name }))
          )
        }
        if (step.action === 'blocked_billing_workspace') {
          children.push(
            text(h, m.account_billing_workspace_warning({ workspace: name })),
            link(h, `/workspaces/${step.workspace.slug}/billing`, name)
          )
        }
      }
    }
    accountActions.push(
      panel(h, m.panel_delete_account(), m.panel_delete_account_description(), children)
    )
  }
  const connections = model.flags.connections.filter(
    (row) => !revokedClients.has(row.id)
  )
  accountActions.push(
    panel(h, m.panel_mcp_clients(), m.panel_mcp_clients_description(), [
      ...(connections.length
        ? []
        : [text(h, m.empty_no_clients()), text(h, m.mcp_empty_description())]),
      h.ul(
        [h.Class('divide-y divide-border')],
        connections.map((row) => {
          const name = row.client.name ?? row.client.clientId
          return h.li(
            [h.Class('flex flex-wrap items-center justify-between gap-3 py-3')],
            [
              h.div(
                [h.Class('min-w-0 flex-1')],
                [
                  h.p(
                    [h.Class('text-sm font-medium')],
                    [`${name} · ${row.workspace?.name ?? m.workspace_removed()}`]
                  ),
                  text(
                    h,
                    `${row.resources?.join(', ') ?? ''} ${row.scopes.join(' ')} · ${formatTimestamp(row.grantedAt, { dateStyle: 'medium' })}`
                  )
                ]
              ),
              button(
                h,
                m.action_revoke(),
                request({
                  _tag: 'RevokeClient',
                  id: row.id,
                  name,
                  workspace: row.workspace?.name ?? m.the_workspace()
                }),
                disabled,
                `Revoke ${name}`
              )
            ]
          )
        })
      )
    ])
  )
  const rendered = region === 'deletion-connections' ? accountActions : [...sections]
  if (region === 'all') {
    rendered.push(...accountActions)
  }
  const accountConfirmation =
    model.confirming?._tag === 'DeleteAccount' ||
    model.confirming?._tag === 'RevokeClient'
  const showConfirmation =
    region === 'all' ||
    (region === 'deletion-connections' ? accountConfirmation : !accountConfirmation)
  if (model.confirming && showConfirmation) {
    const op = model.confirming
    let title = m.shell_preferences_reload_title()
    let description = m.shell_preferences_reload_description()
    let label = m.shell_save()
    if (op._tag === 'DeleteAccount') {
      title = m.delete_your_account()
      description = m.delete_account_confirm_description()
      label = m.confirm_delete_account()
    } else if (op._tag === 'DeleteConversation') {
      title = m.assistant_conversations_delete_title()
      description = m.assistant_conversations_delete_description()
      label = m.assistant_conversations_delete()
    } else if (op._tag === 'RevokeClient') {
      title = m.revoke_named({ name: op.name })
      description = m.mcp_revoke_description({ workspace: op.workspace })
      label = m.revoke_access()
    }
    rendered.push(
      confirmation(
        h,
        title,
        description,
        { _tag: 'Confirmed' },
        { _tag: 'Cancelled' },
        model.pending,
        model.error,
        label
      )
    )
  }
  return h.div([h.Class('grid gap-6')], rendered)
}
