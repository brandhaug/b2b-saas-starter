import { type Update } from 'foldkit'
import { m } from '@b2b-saas-starter/i18n/messages'
import { mergeConversationHistory } from '@/lib/assistant-conversation-stream'
import { validateWorkspaceName } from '@/lib/workspace-name'
import { type Flags, type Model, type Message, type Action } from './model'
import {
  Ready,
  Run,
  Prepare,
  Navigate,
  Copy,
  Back,
  DismissPopover,
  CloseDialog
} from './commands'
import { query } from './ui'
import { allowed, allowedDialog } from './authorization'
import { auditPage } from './preview'
import * as Checkout from './checkout'

function locationDialog(page: Model['page'], url: URL): Model['dialog'] {
  const search = url.searchParams
  let dialog: Model['dialog'] = null
  if (search.get('action') === 'invite' && page._tag === 'members') {
    dialog = 'invite'
  } else if (search.get('action') === 'create' && page._tag === 'api-tokens') {
    dialog = 'token'
  } else if (search.get('action') === 'create' && page._tag === 'webhooks') {
    dialog = 'webhook'
  } else if (
    page._tag === 'webhooks' &&
    page.data.endpoints.some((endpoint) => endpoint.id === search.get('record'))
  ) {
    dialog = 'deliveries'
  } else if (page._tag === 'audit' && search.has('event')) {
    dialog = 'audit'
  }
  return dialog
}

export function init(flags: Flags): Update.Return<Model, Message> {
  const page = flags.page
  const search = new URL(flags.url).searchParams
  const dialog = locationDialog(page, new URL(flags.url))
  return Checkout.synchronize({
    model: {
      flags,
      checkout: null,
      tableSearch: {},
      tableOperators: {},
      tablePopover: null,
      page,
      url: flags.url,
      ready: false,
      pending: false,
      pendingAction: null,
      request: 0,
      error: null,
      failedAction: null,
      notice: null,
      dialog,
      dialogClosing: false,
      confirmation: null,
      historyOpened: false,
      secret: null,
      secretVisible: false,
      members: { emails: '', role: 'member', batchRole: 'member', results: [] },
      settings: {
        name: page._tag === 'settings' ? page.data.workspaceName : '',
        confirmation: '',
        protocol: 'oidc',
        domain: '',
        issuer: '',
        clientId: '',
        clientSecret: '',
        metadataUrl: '',
        metadataXml: '',
        role: 'member'
      },
      tokens: {
        name: '',
        scopes: ['read'],
        expiry: '',
        overlap: '3600',
        replacement: null
      },
      webhooks: {
        url: '',
        events: ['api_token.created'],
        editing: null,
        delivery: null,
        attempts: [],
        wrap: true
      },
      billing: {
        interval:
          page._tag === 'billing' ? (page.data.lifecycle.interval ?? 'month') : 'month',
        tokenIds:
          page._tag === 'billing'
            ? (page.data.resourceSelection?.apiTokenIds ?? []).filter((id) =>
                page.data.apiTokens.some((token) => token.id === id)
              )
            : [],
        endpointIds:
          page._tag === 'billing'
            ? (page.data.resourceSelection?.webhookEndpointIds ?? []).filter((id) =>
                page.data.webhookEndpoints.some((endpoint) => endpoint.id === id)
              )
            : []
      },
      assistant: {
        conversations: [],
        nextCursor: null,
        conversationId: search.get('conversationId'),
        history: null,
        connection: 'connecting',
        generation: 0,
        question: '',
        intentText: '',
        intentTask: '',
        intentKey: '',
        retryAttempt: '',
        retryKey: '',
        deliveryId: search.get('deliveryId') ?? '',
        investigation: m.assistant_investigation_default_question(),
        selectedTask:
          page._tag === 'assistant'
            ? (page.data.investigations?.tasks.find(
                (task) => task.id === search.get('taskId')
              ) ??
              (!search.has('deliveryId') && !search.has('taskId')
                ? page.data.investigations?.tasks[0]
                : null) ??
              null)
            : null
      }
    },
    commands: [Ready()]
  })
}
function toggle<A>(values: ReadonlyArray<A>, value: A) {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value]
}
function perform(model: Model, action: Action): Update.Return<Model, Message> {
  if (
    model.ready &&
    model.pending &&
    action._tag === 'Refresh' &&
    model.page._tag === 'billing'
  ) {
    return { model, commands: [Run({ model, action })] }
  }
  if (!model.ready || model.pending) {
    return { model }
  }
  if (!allowed(model, action)) {
    return { model: { ...model, error: m.workspace_manage_denied() } }
  }
  if (model.flags.preview && action._tag !== 'Attempts' && action._tag !== 'Refresh') {
    return {
      model: {
        ...model,
        error: m.shell_demo_read_only(),
        confirmation: null,
        dialog: model.confirmation ? null : model.dialog
      }
    }
  }
  let error: string | undefined
  if (action._tag === 'Rename') {
    error = validateWorkspaceName(model.settings.name)
  } else if (action._tag === 'DeleteWorkspace') {
    if (model.settings.confirmation.trim() !== model.flags.slug) {
      return { model }
    }
  } else if (action._tag === 'CreateToken') {
    if (!model.tokens.name.trim()) {
      error = m.token_name_required()
    } else if (model.tokens.name.length > 100) {
      error = m.token_name_maximum()
    } else if (!model.tokens.scopes.length) {
      error = m.scope_required()
    }
  } else if (action._tag === 'ReplaceToken') {
    if (!model.tokens.scopes.length) {
      error = m.replacement_scope_required()
    } else if (
      !Number.isInteger(Number(model.tokens.overlap)) ||
      Number(model.tokens.overlap) < 0 ||
      Number(model.tokens.overlap) > 86_400
    ) {
      error = m.token_overlap_range()
    }
  } else if (action._tag === 'CreateSso') {
    if (!model.settings.domain.trim()) {
      error = m.sso_domain_required()
    } else if (model.settings.protocol === 'oidc' && !model.settings.issuer.trim()) {
      error = m.sso_issuer_required()
    } else if (
      model.settings.issuer &&
      (!URL.canParse(model.settings.issuer) ||
        new URL(model.settings.issuer).protocol !== 'https:')
    ) {
      error = m.sso_issuer_https()
    } else if (
      model.settings.metadataUrl &&
      (!URL.canParse(model.settings.metadataUrl) ||
        new URL(model.settings.metadataUrl).protocol !== 'https:')
    ) {
      error = m.sso_metadata_https()
    } else if (
      model.settings.protocol === 'saml' &&
      !model.settings.metadataUrl.trim() &&
      !model.settings.metadataXml.trim()
    ) {
      error = m.sso_metadata_required()
    }
  } else if (action._tag === 'CreateWebhook' || action._tag === 'SaveWebhook') {
    if (!model.webhooks.url.trim()) {
      error = m.endpoint_url_required()
    } else if (!model.webhooks.events.length) {
      error = m.webhook_event_required()
    }
  } else if (action._tag === 'Send') {
    const latest = model.assistant.history?.items.at(-1)?.attempts.at(-1)
    if (
      model.page._tag !== 'assistant' ||
      !model.page.data.configured ||
      !model.assistant.conversationId ||
      !model.assistant.question.trim() ||
      model.assistant.question.length > 2000 ||
      model.assistant.connection === 'denied' ||
      latest?.status === 'Accepted' ||
      latest?.status === 'Running'
    ) {
      return { model }
    }
  }
  if (error) {
    return { model: { ...model, error } }
  }
  const next: Model = {
    ...model,
    pending: true,
    pendingAction: action,
    request: model.request + 1,
    error: model.error,
    failedAction: model.failedAction,
    notice: null,
    members:
      action._tag === 'Invite' && !action.retry
        ? { ...model.members, batchRole: model.members.role, results: [] }
        : model.members,
    webhooks:
      action._tag === 'Attempts'
        ? { ...model.webhooks, delivery: action.id, attempts: [] }
        : model.webhooks,
    confirmation: null,
    dialog: model.confirmation ? null : model.dialog
  }
  return {
    model: next,
    commands: [
      ['CreateToken', 'Send', 'RetryAnswer'].includes(action._tag)
        ? Prepare({ request: next.request })
        : Run({ model: next, action })
    ]
  }
}
function changeQuery(
  model: Model,
  key: string,
  value: string,
  replace: boolean
): Update.Return<Model, Message> {
  const url = new URL(model.url)
  if (value) {
    url.searchParams.set(key, value)
  } else {
    url.searchParams.delete(key)
  }
  if (
    ['query', 'tableViews', 'view', 'eventType', 'actor', 'since', 'until'].includes(
      key
    )
  ) {
    url.searchParams.delete('page')
    url.searchParams.delete('cursor')
  }
  const next: Model = {
    ...model,
    url: url.href,
    historyOpened: key === 'event' && Boolean(value),
    page:
      model.flags.preview && model.page._tag === 'audit' ? auditPage(url) : model.page,
    dialog: queryDialog(model, key, value)
  }
  const reload =
    model.page._tag === 'audit' &&
    ['event', 'eventType', 'actor', 'since', 'until', 'cursor', 'view'].includes(key)
  if (reload && !model.flags.preview) {
    const fresh: Model = {
      ...next,
      pending: true,
      pendingAction: { _tag: 'Refresh' },
      request: model.request + 1,
      error: null
    }
    return {
      model: fresh,
      commands: [
        Navigate({ url: url.href, replace }),
        Run({ model: fresh, action: { _tag: 'Refresh' } })
      ]
    }
  }
  return { model: next, commands: [Navigate({ url: url.href, replace })] }
}
function queryDialog(model: Model, key: string, value: string): Model['dialog'] {
  if (key === 'record' && model.page._tag === 'webhooks') {
    return value ? 'deliveries' : null
  }
  if (key === 'event') {
    return value ? 'audit' : null
  }
  return model.dialog
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  return Checkout.synchronize(updateWorkspace(model, message))
}
function updateWorkspace(
  model: Model,
  message: Message
): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Checkout': {
      return Checkout.update(model, message.message)
    }
    case 'Noop': {
      return { model }
    }
    case 'Ready': {
      const next = { ...model, ready: true }
      if (model.page._tag === 'assistant' && !model.flags.preview) {
        const result = perform(next, { _tag: 'ListConversations', cursor: null })
        return {
          ...result,
          commands: [
            ...(result.commands ?? []),
            ...(next.assistant.selectedTask
              ? [
                  Run({
                    model: result.model,
                    action: { _tag: 'ReadTask', id: next.assistant.selectedTask.id }
                  })
                ]
              : [])
          ]
        }
      }
      if (
        model.page._tag === 'billing' &&
        query(model, 'checkout') === 'success' &&
        !model.flags.preview
      ) {
        return perform(next, { _tag: 'Reconcile' })
      }
      return { model: next }
    }
    case 'Perform': {
      return perform(model, message.action)
    }
    case 'Prepared': {
      const action = model.pendingAction
      if (message.request !== model.request || !model.pending || !action) {
        return { model }
      }
      if (
        action._tag === 'CreateToken' &&
        model.tokens.expiry &&
        !(Date.parse(`${model.tokens.expiry}Z`) > message.now)
      ) {
        return {
          model: {
            ...model,
            pending: false,
            pendingAction: null,
            error: m.expiry_future_required()
          }
        }
      }
      let assistant = model.assistant
      if (action._tag === 'Send') {
        const text = assistant.question.trim()
        const task = assistant.selectedTask?.id ?? ''
        if (
          !assistant.intentKey ||
          assistant.intentText !== text ||
          assistant.intentTask !== task
        ) {
          assistant = {
            ...assistant,
            intentText: text,
            intentTask: task,
            intentKey: message.key
          }
        }
      } else if (
        action._tag === 'RetryAnswer' &&
        (assistant.retryAttempt !== action.id || !assistant.retryKey)
      ) {
        assistant = { ...assistant, retryAttempt: action.id, retryKey: message.key }
      }
      const next = { ...model, assistant }
      return { model: next, commands: [Run({ model: next, action })] }
    }
    case 'Confirmed': {
      return model.confirmation ? perform(model, model.confirmation) : { model }
    }
    case 'Confirm': {
      return model.pending
        ? { model }
        : {
            model: {
              ...model,
              confirmation: message.action,
              dialog: message.title,
              dialogClosing: false,
              settings: { ...model.settings, confirmation: '' }
            }
          }
    }
    case 'Open': {
      if (!allowedDialog(model, message.dialog)) {
        return { model }
      }
      const changed = changeQuery(
        model,
        'action',
        message.dialog === 'invite' ? 'invite' : 'create',
        false
      )
      return {
        ...changed,
        model: {
          ...changed.model,
          dialog: message.dialog,
          dialogClosing: false,
          secret: null,
          error: null,
          tokens: { ...model.tokens, replacement: null },
          webhooks: { ...model.webhooks, editing: null }
        }
      }
    }
    case 'Close': {
      if (model.dialog === null && model.tokens.replacement !== null) {
        return {
          model: {
            ...model,
            secret: null,
            secretVisible: false,
            tokens: { ...model.tokens, replacement: null }
          }
        }
      }
      return model.dialog === null || model.dialogClosing
        ? { model }
        : { model: { ...model, dialogClosing: true }, commands: [CloseDialog()] }
    }
    case 'DialogClosed': {
      if (!model.dialogClosing) {
        return { model }
      }
      if (model.dialog === 'audit' && model.historyOpened) {
        return {
          model: { ...model, dialog: null, dialogClosing: false },
          commands: [Back()]
        }
      }
      let dialogKey = 'action'
      if (model.dialog === 'audit') {
        dialogKey = 'event'
      }
      if (model.dialog === 'deliveries') {
        dialogKey = 'record'
      }
      const changed = changeQuery(model, dialogKey, '', true)
      return {
        ...changed,
        model: {
          ...changed.model,
          dialog: null,
          dialogClosing: false,
          confirmation: null,
          secret: null,
          tokens: { ...model.tokens, replacement: null }
        }
      }
    }
    case 'Query': {
      const next = message.draftOperator
        ? {
            ...model,
            tableOperators: {
              ...model.tableOperators,
              [message.draftOperator.id]: message.draftOperator.operator
            }
          }
        : model
      const result = changeQuery(next, message.key, message.value, message.replace)
      if (!message.dismiss) {
        return result
      }
      return {
        ...result,
        commands: [...(result.commands ?? []), DismissPopover({ id: message.dismiss })]
      }
    }
    case 'TableSearch': {
      return {
        model: {
          ...model,
          tableSearch: { ...model.tableSearch, [message.key]: message.value }
        }
      }
    }
    case 'ClearList': {
      const url = new URL(model.url)
      url.searchParams.delete(
        message.key === 'invitations' ? 'invitationQuery' : 'query'
      )
      url.searchParams.delete('page')
      if (message.key === 'audit') {
        for (const key of ['actor', 'eventType', 'since', 'until', 'cursor']) {
          url.searchParams.delete(key)
        }
      }
      return changeQuery(
        { ...model, url: url.href },
        message.key === 'audit' ? 'view' : 'tableViews',
        message.tableViews,
        false
      )
    }
    case 'TableOpen': {
      return {
        model: {
          ...model,
          tableSearch: { ...model.tableSearch, [message.id]: '' },
          tableOperators: { ...model.tableOperators, [message.id]: message.operator }
        }
      }
    }
    case 'TablePopover': {
      if (message.open) {
        return { model: { ...model, tablePopover: message.id } }
      }
      return {
        model: {
          ...model,
          tablePopover: model.tablePopover === message.id ? null : model.tablePopover
        }
      }
    }
    case 'Location': {
      if (['members', 'api-tokens', 'webhooks'].includes(model.page._tag)) {
        const url = new URL(message.url)
        const dialog = locationDialog(model.page, url)
        return {
          model: {
            ...model,
            url: message.url,
            dialog,
            dialogClosing: false,
            confirmation: null
          }
        }
      }
      const next = { ...model, url: message.url }
      const id = new URL(message.url).searchParams.get('conversationId')
      if (model.page._tag === 'assistant' && id !== model.assistant.conversationId) {
        return {
          model: {
            ...next,
            request: model.request + 1,
            pending: false,
            pendingAction: null,
            error: null,
            failedAction: null,
            assistant: {
              ...model.assistant,
              conversationId: id,
              history: null,
              generation: model.assistant.generation + 1,
              connection: 'connecting'
            }
          }
        }
      }
      if (model.page._tag === 'audit') {
        const url = new URL(message.url)
        const fresh: Model = {
          ...next,
          dialog: url.searchParams.has('event') ? 'audit' : null,
          pending: !model.flags.preview,
          pendingAction: { _tag: 'Refresh' },
          request: model.request + 1,
          error: null
        }
        if (model.flags.preview) {
          return { model: { ...fresh, page: auditPage(url), pendingAction: null } }
        }
        return {
          model: fresh,
          commands: [Run({ model: fresh, action: { _tag: 'Refresh' } })]
        }
      }
      if (model.page._tag === 'assistant') {
        const taskId = new URL(message.url).searchParams.get('taskId')
        if (taskId && taskId !== model.assistant.selectedTask?.id) {
          const selectedTask =
            model.page.data.investigations?.tasks.find((task) => task.id === taskId) ??
            null
          return perform(
            { ...next, pending: false, assistant: { ...next.assistant, selectedTask } },
            { _tag: 'ReadTask', id: taskId }
          )
        }
      }
      return { model: next }
    }
    case 'Failed': {
      if (message.request !== model.request) {
        return { model }
      }
      const next = {
        ...model,
        pending: false,
        pendingAction: null,
        error: message.error,
        failedAction: model.pendingAction
      }
      if (model.pendingAction?._tag === 'ApproveTask') {
        return {
          model: next,
          commands: [
            Run({
              model: next,
              action: { _tag: 'ReadTask', id: model.pendingAction.id }
            })
          ]
        }
      }
      return { model: next }
    }
    case 'Copy': {
      return {
        model,
        commands: [
          Copy({
            text: message.text,
            secret: message.secret ?? false
          })
        ]
      }
    }
    case 'Copied': {
      return { model: { ...model, notice: message.notice } }
    }
    case 'ToggleSecret': {
      return { model: { ...model, secretVisible: !model.secretVisible } }
    }
    case 'Completed': {
      if (message.request !== model.request) {
        return { model }
      }
      const next: Model = {
        ...model,
        pending: false,
        pendingAction: null,
        error: null,
        failedAction: null
      }
      const result = message.result
      switch (result._tag) {
        case 'Page': {
          let billing = next.billing
          if (result.page._tag === 'billing' && model.page._tag === 'billing') {
            const previous = model.page.data
            const fresh = result.page.data
            const sameSelection =
              JSON.stringify(previous.resourceSelection) ===
              JSON.stringify(fresh.resourceSelection)
            const sameInventory =
              JSON.stringify(previous.apiTokens) === JSON.stringify(fresh.apiTokens) &&
              JSON.stringify(previous.webhookEndpoints) ===
                JSON.stringify(fresh.webhookEndpoints)
            if (!sameSelection || !sameInventory) {
              billing = {
                ...billing,
                tokenIds: (fresh.resourceSelection?.apiTokenIds ?? []).filter((id) =>
                  fresh.apiTokens.some((row) => row.id === id)
                ),
                endpointIds: (fresh.resourceSelection?.webhookEndpointIds ?? []).filter(
                  (id) => fresh.webhookEndpoints.some((row) => row.id === id)
                )
              }
            }
          }
          return {
            model: {
              ...next,
              billing,
              pending:
                model.pendingAction?._tag === 'SelectResources'
                  ? model.pending
                  : next.pending,
              pendingAction:
                model.pendingAction?._tag === 'SelectResources'
                  ? model.pendingAction
                  : next.pendingAction,
              page: result.page,
              settings:
                result.page._tag === 'settings'
                  ? {
                      ...next.settings,
                      name: result.page.data.workspaceName,
                      clientSecret: ''
                    }
                  : next.settings
            }
          }
        }
        case 'Done': {
          const done = { ...next, notice: result.notice }
          if (
            model.page._tag === 'assistant' &&
            model.assistant.conversationId &&
            ['Send', 'RetryAnswer', 'StopAnswer'].includes(
              model.pendingAction?._tag ?? ''
            )
          ) {
            return perform(
              {
                ...done,
                assistant: {
                  ...done.assistant,
                  question:
                    model.pendingAction?._tag === 'Send'
                      ? ''
                      : model.assistant.question,
                  intentKey:
                    model.pendingAction?._tag === 'Send'
                      ? ''
                      : model.assistant.intentKey,
                  retryKey:
                    model.pendingAction?._tag === 'RetryAnswer'
                      ? ''
                      : model.assistant.retryKey
                }
              },
              { _tag: 'History', cursor: null }
            )
          }
          return {
            model: done,
            commands: [Run({ model: done, action: { _tag: 'Refresh' } })]
          }
        }
        case 'Secret': {
          const done = {
            ...next,
            secret: result.secret,
            secretVisible: false,
            notice: result.notice
          }
          return {
            model: done,
            commands: [Run({ model: done, action: { _tag: 'Refresh' } })]
          }
        }
        case 'Invitations': {
          const attempted = new Set(result.results.map((entry) => entry.email))
          const results = [
            ...model.members.results.filter((entry) => !attempted.has(entry.email)),
            ...result.results
          ]
          const done = {
            ...next,
            members: {
              ...model.members,
              emails: results.every((entry) => entry.ok) ? '' : model.members.emails,
              results
            }
          }
          return {
            model: done,
            commands: [Run({ model: done, action: { _tag: 'Refresh' } })]
          }
        }
        case 'Attempts': {
          return {
            model: {
              ...next,
              webhooks: { ...model.webhooks, attempts: result.attempts }
            }
          }
        }
        case 'Conversations': {
          const items = result.append
            ? [
                ...model.assistant.conversations.filter(
                  (existing) => !result.items.some((item) => item.id === existing.id)
                ),
                ...result.items
              ]
            : result.items
          return {
            model: {
              ...next,
              assistant: {
                ...model.assistant,
                conversations: items,
                nextCursor: result.nextCursor
              }
            }
          }
        }
        case 'CreatedConversation': {
          return update(next, { _tag: 'SelectConversation', id: result.id })
        }
        case 'DeletedConversation': {
          const changed = changeQuery(next, 'conversationId', '', false)
          return {
            ...changed,
            model: {
              ...changed.model,
              assistant: {
                ...model.assistant,
                conversationId: null,
                history: null,
                conversations: model.assistant.conversations.filter(
                  (row) => row.id !== model.assistant.conversationId
                ),
                generation: model.assistant.generation + 1
              }
            }
          }
        }
        case 'History': {
          if (
            result.conversationId !== model.assistant.conversationId ||
            (result.cursor !== null &&
              result.cursor !== model.assistant.history?.nextCursor)
          ) {
            return { model: next }
          }
          return {
            model: {
              ...next,
              assistant: {
                ...model.assistant,
                history: mergeConversationHistory(
                  model.assistant.history,
                  result.history,
                  result.cursor === null ? 'snapshot' : 'page'
                )
              }
            }
          }
        }
        case 'Task': {
          const changed =
            query(next, 'taskId') === result.task.id
              ? { model: next }
              : changeQuery(next, 'taskId', result.task.id, false)
          const page =
            model.page._tag === 'assistant' && model.page.data.investigations
              ? {
                  ...model.page,
                  data: {
                    ...model.page.data,
                    investigations: {
                      ...model.page.data.investigations,
                      tasks: [
                        result.task,
                        ...model.page.data.investigations.tasks.filter(
                          (task) => task.id !== result.task.id
                        )
                      ]
                    }
                  }
                }
              : model.page
          return {
            ...changed,
            model: {
              ...changed.model,
              page,
              assistant: { ...model.assistant, selectedTask: result.task }
            }
          }
        }
        case 'AccessLost': {
          return {
            model: {
              ...next,
              error: result.message,
              assistant: {
                ...model.assistant,
                history: null,
                conversations: [],
                nextCursor: null,
                connection: 'denied',
                generation: model.assistant.generation + 1
              }
            }
          }
        }
        default: {
          return result satisfies never
        }
      }
    }
    case 'MemberField': {
      const role =
        message.value === 'owner' || message.value === 'admin'
          ? message.value
          : 'member'
      return {
        model: {
          ...model,
          members:
            message.field === 'role'
              ? {
                  ...model.members,
                  role
                }
              : { ...model.members, emails: message.value }
        }
      }
    }
    case 'SettingField': {
      const settings = { ...model.settings }
      if (message.field === 'protocol') {
        settings.protocol = message.value === 'saml' ? 'saml' : 'oidc'
      } else if (message.field === 'role') {
        settings.role = message.value === 'admin' ? 'admin' : 'member'
      } else {
        settings[message.field] = message.value
      }
      return {
        model: {
          ...model,
          settings,
          error:
            settings.protocol === 'saml' &&
            !settings.metadataUrl.trim() &&
            !settings.metadataXml.trim()
              ? m.sso_metadata_required()
              : null
        }
      }
    }
    case 'TokenField': {
      let error: string | null = null
      if (message.field === 'name') {
        if (!message.value.trim()) {
          error = m.token_name_required()
        } else if (message.value.length > 100) {
          error = m.token_name_maximum()
        }
      } else if (
        message.field === 'overlap' &&
        (!Number.isInteger(Number(message.value)) ||
          Number(message.value) < 0 ||
          Number(message.value) > 86_400)
      ) {
        error = m.token_overlap_range()
      }
      return {
        model: {
          ...model,
          error,
          tokens: { ...model.tokens, [message.field]: message.value }
        }
      }
    }
    case 'TokenScope': {
      const scopes = toggle(model.tokens.scopes, message.scope)
      return {
        model: {
          ...model,
          error: scopes.length ? null : m.scope_required(),
          tokens: {
            ...model.tokens,
            scopes
          }
        }
      }
    }
    case 'Replace': {
      const token =
        model.page._tag === 'api-tokens'
          ? model.page.data.tokens.find((candidate) => candidate.id === message.id)
          : undefined
      return token
        ? {
            model: {
              ...model,
              secret: null,
              tokens: { ...model.tokens, replacement: token.id, scopes: token.scopes }
            }
          }
        : { model }
    }
    case 'WebhookField': {
      return {
        model: { ...model, webhooks: { ...model.webhooks, url: message.value } }
      }
    }
    case 'WebhookEvent': {
      return {
        model: {
          ...model,
          webhooks: {
            ...model.webhooks,
            events: toggle(model.webhooks.events, message.event)
          }
        }
      }
    }
    case 'EditWebhook': {
      const endpoint =
        model.page._tag === 'webhooks'
          ? model.page.data.endpoints.find((candidate) => candidate.id === message.id)
          : undefined
      return endpoint
        ? {
            model: {
              ...model,
              dialog: 'webhook',
              secret: null,
              webhooks: {
                ...model.webhooks,
                editing: endpoint.id,
                url: endpoint.url,
                events: endpoint.events
              }
            }
          }
        : { model }
    }
    case 'Wrap': {
      return {
        model: { ...model, webhooks: { ...model.webhooks, wrap: !model.webhooks.wrap } }
      }
    }
    case 'HideAttempts': {
      return model.pending
        ? { model }
        : {
            model: {
              ...model,
              webhooks: { ...model.webhooks, delivery: null, attempts: [] }
            }
          }
    }
    case 'Interval': {
      return {
        model: { ...model, billing: { ...model.billing, interval: message.value } }
      }
    }
    case 'Resource': {
      if (model.pending) {
        return { model }
      }
      if (model.page._tag === 'billing') {
        const selected =
          message.kind === 'token' ? model.billing.tokenIds : model.billing.endpointIds
        const entitlement =
          message.kind === 'token'
            ? model.page.data.resourceEntitlements.apiTokens
            : model.page.data.resourceEntitlements.webhookEndpoints
        if (
          !selected.includes(message.id) &&
          entitlement.limit !== null &&
          selected.length >= entitlement.limit
        ) {
          return { model }
        }
      }
      return {
        model: {
          ...model,
          billing:
            message.kind === 'token'
              ? {
                  ...model.billing,
                  tokenIds: toggle(model.billing.tokenIds, message.id)
                }
              : {
                  ...model.billing,
                  endpointIds: toggle(model.billing.endpointIds, message.id)
                }
        }
      }
    }
    case 'AssistantField': {
      return {
        model: {
          ...model,
          assistant: { ...model.assistant, [message.field]: message.value }
        }
      }
    }
    case 'SelectConversation': {
      const changed = changeQuery(model, 'conversationId', message.id, false)
      const next = {
        ...changed.model,
        pending: false,
        request: model.request + 1,
        assistant: {
          ...model.assistant,
          conversationId: message.id,
          history: null,
          generation: model.assistant.generation + 1,
          connection: 'connecting' as const,
          intentKey: '',
          retryKey: ''
        }
      }
      return {
        model: next,
        commands: [
          ...(changed.commands ?? []),
          Run({ model: next, action: { _tag: 'ListConversations', cursor: null } })
        ]
      }
    }
    case 'SelectTask': {
      const changed = changeQuery(model, 'taskId', message.id, false)
      const next = {
        ...changed.model,
        pending: false,
        assistant: {
          ...model.assistant,
          selectedTask:
            model.page._tag === 'assistant'
              ? (model.page.data.investigations?.tasks.find(
                  (task) => task.id === message.id
                ) ?? null)
              : null
        }
      }
      const result = perform(next, { _tag: 'ReadTask', id: message.id })
      return {
        ...result,
        commands: [...(changed.commands ?? []), ...(result.commands ?? [])]
      }
    }
    case 'Reconnect': {
      return {
        model: {
          ...model,
          assistant: {
            ...model.assistant,
            connection: 'connecting',
            generation: model.assistant.generation + 1
          }
        }
      }
    }
    case 'Snapshot': {
      if (
        message.conversationId !== model.assistant.conversationId ||
        message.generation !== model.assistant.generation ||
        model.assistant.connection === 'denied'
      ) {
        return { model }
      }
      return {
        model: {
          ...model,
          assistant: {
            ...model.assistant,
            history: mergeConversationHistory(
              model.assistant.history,
              message.history,
              'snapshot'
            )
          }
        }
      }
    }
    case 'Connection': {
      if (
        message.conversationId !== model.assistant.conversationId ||
        message.generation !== model.assistant.generation
      ) {
        return { model }
      }
      return {
        model: {
          ...model,
          assistant: {
            ...model.assistant,
            connection: message.state,
            history: message.state === 'denied' ? null : model.assistant.history,
            conversations:
              message.state === 'denied' ? [] : model.assistant.conversations,
            nextCursor: message.state === 'denied' ? null : model.assistant.nextCursor
          }
        }
      }
    }
  }
}
