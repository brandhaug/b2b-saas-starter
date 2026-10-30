import { Effect, Schema, type Types } from 'effect'
import { Command, Render } from 'foldkit'
import { m } from '@b2b-saas-starter/i18n/messages'
import { loadWorkspaceDashboardServerFn } from '@/lib/server/workspace-dashboard'
import { loadWorkspaceMembersServerFn } from '@/lib/server/workspace-members'
import { loadWorkspaceSettingsServerFn } from '@/lib/server/workspace-settings'
import { loadWorkspaceBillingServerFn } from '@/lib/server/billing'
import { loadWorkspaceApiTokensServerFn } from '@/lib/server/api-tokens'
import { loadWorkspaceWebhooksServerFn } from '@/lib/server/webhooks'
import {
  loadWorkspaceAuditEventsServerFn,
  type WorkspaceAuditInput
} from '@/lib/server/workspace-audit'
import { loadAssistantPageServerFn } from '@/lib/server/assistant'
import { loadWorkspaceRecoveryServerFn } from '@/lib/server/workspace-suspension'
import { dismissOnboardingChecklistServerFn } from '@/lib/server/workspace-onboarding'
import { markNotificationsReadServerFn } from '@/lib/server/notifications'
import { call } from '../server-call'
import { Action, Message, Model, type Result, type WorkspacePage } from './model'
import * as Members from './members'
import * as Settings from './settings'
import * as Tokens from './tokens'
import * as Webhooks from './webhooks'
import * as Billing from './billing'
import * as Assistant from './assistant'
import { auditFiltersFromSearch, auditViewFromSearch } from '@/lib/audit-search'
import { demoWebhookPorts } from '@/lib/demo-fixtures'
import { auditPage } from './preview'

export const CloseDialog = Command.define('Workspace.CloseDialog', {
  messages: [Message.cases.DialogClosed],
  execute: Effect.gen(function* () {
    yield* Render.afterCommit
    const dialog = document.getElementById('workspace-dialog')
    if (dialog) {
      // Flush the ending style before collecting transitions. Their actual lifetime
      // respects reduced motion, keyboard input and browser playback-rate changes.
      void window.getComputedStyle(dialog).opacity
      yield* Effect.forEach(
        dialog.getAnimations(),
        (animation) => Effect.promise(() => animation.finished.catch(() => undefined)),
        { concurrency: 'unbounded' }
      )
    }
    return Message.cases.DialogClosed.make({})
  })
})

export function refresh(model: Model) {
  const workspaceSlug = model.flags.slug
  const data = { workspaceSlug }
  return Effect.gen(function* () {
    let page: WorkspacePage
    switch (model.page._tag) {
      case 'dashboard': {
        page = {
          _tag: 'dashboard',
          data: yield* call(
            () => loadWorkspaceDashboardServerFn({ data }),
            m.notifications_refresh_failed()
          )
        }
        break
      }
      case 'members': {
        page = {
          _tag: 'members',
          data: yield* call(
            () => loadWorkspaceMembersServerFn({ data }),
            m.shell_save_error()
          )
        }
        break
      }
      case 'settings': {
        page = {
          _tag: 'settings',
          data: yield* call(
            () => loadWorkspaceSettingsServerFn({ data }),
            m.shell_save_error()
          )
        }
        break
      }
      case 'billing': {
        page = {
          _tag: 'billing',
          data: yield* call(
            () => loadWorkspaceBillingServerFn({ data }),
            m.shell_save_error()
          )
        }
        break
      }
      case 'api-tokens': {
        page = {
          _tag: 'api-tokens',
          data: yield* call(
            () => loadWorkspaceApiTokensServerFn({ data }),
            m.shell_save_error()
          )
        }
        break
      }
      case 'webhooks': {
        page = {
          _tag: 'webhooks',
          data: yield* call(
            () => loadWorkspaceWebhooksServerFn({ data }),
            m.shell_save_error()
          )
        }
        break
      }
      case 'audit': {
        const search = new URL(model.url).searchParams
        const input: Types.Mutable<WorkspaceAuditInput> = {
          workspaceSlug,
          view: auditViewFromSearch(search.get('view') ?? undefined),
          filters: auditFiltersFromSearch({
            actor: search.get('actor') ?? undefined,
            eventType: search.get('eventType') ?? undefined,
            since: search.get('since') ?? undefined,
            until: search.get('until') ?? undefined
          })
        }
        for (const key of ['cursor', 'event'] as const) {
          const value = search.get(key)
          if (value) {
            input[key] = value
          }
        }
        page = {
          _tag: 'audit',
          data: yield* call(
            () => loadWorkspaceAuditEventsServerFn({ data: input }),
            m.shell_save_error()
          )
        }
        break
      }
      case 'assistant': {
        page = {
          _tag: 'assistant',
          data: yield* call(
            () => loadAssistantPageServerFn({ data }),
            m.shell_save_error()
          )
        }
        break
      }
      case 'suspended': {
        page = {
          _tag: 'suspended',
          data: yield* call(
            () => loadWorkspaceRecoveryServerFn({ data }),
            m.shell_save_error()
          )
        }
        break
      }
    }
    return { _tag: 'Page', page } satisfies Result
  })
}
function execute(model: Model, action: Action) {
  const workspaceSlug = model.flags.slug
  switch (action._tag) {
    case 'Refresh': {
      return refresh(model)
    }
    case 'DismissChecklist': {
      return call(
        () => dismissOnboardingChecklistServerFn({ data: { workspaceSlug } }),
        m.dismiss_checklist_failed()
      ).pipe(
        Effect.map((): Result => ({ _tag: 'Done', notice: m.setup_checklist_hidden() }))
      )
    }
    case 'MarkRead': {
      return call(
        () =>
          markNotificationsReadServerFn({ data: { workspaceSlug, ids: action.ids } }),
        m.notification_mark_read_failed()
      ).pipe(
        Effect.map((): Result => ({
          _tag: 'Done',
          notice: m.notifications_marked_count({ count: action.ids.length })
        }))
      )
    }
    case 'Invite':
    case 'Role':
    case 'RemoveMember':
    case 'Leave':
    case 'CancelInvitation':
    case 'ResendInvitation': {
      return Members.execute(model, action)
    }
    case 'Rename':
    case 'DeleteWorkspace':
    case 'CreateSso':
    case 'UpdateSso':
    case 'TestSso':
    case 'RemoveSso':
    case 'Export':
    case 'DownloadExport': {
      return Settings.execute(model, action)
    }
    case 'CreateToken':
    case 'ReplaceToken':
    case 'RevokeToken': {
      return Tokens.execute(model, action)
    }
    case 'CreateWebhook':
    case 'SaveWebhook':
    case 'ToggleWebhook':
    case 'RotateWebhook':
    case 'TestWebhook':
    case 'ReplayWebhook':
    case 'Attempts': {
      return Webhooks.execute(model, action)
    }
    case 'Checkout':
    case 'Portal':
    case 'Reconcile':
    case 'SelectResources': {
      return Billing.execute(model, action)
    }
    case 'ListConversations':
    case 'CreateConversation':
    case 'History':
    case 'Send':
    case 'RetryAnswer':
    case 'StopAnswer':
    case 'DeleteConversation':
    case 'Investigate':
    case 'ReadTask':
    case 'ApproveTask':
    case 'CancelTask': {
      return Assistant.execute(model, action)
    }
  }
}
export const Run = Command.define('Workspace.Run', {
  args: { model: Model, action: Action },
  messages: [Message.cases.Completed, Message.cases.Failed],
  execute: ({ model, action }) => {
    if (model.flags.preview) {
      if (action._tag === 'Attempts') {
        return Effect.promise(() =>
          demoWebhookPorts.listAttempts({ data: { deliveryId: action.id } })
        ).pipe(
          Effect.map((attempts) =>
            Message.cases.Completed.make({
              request: model.request,
              result: { _tag: 'Attempts', attempts }
            })
          )
        )
      }
      if (action._tag === 'Refresh') {
        const page =
          model.page._tag === 'audit' ? auditPage(new URL(model.url)) : model.page
        return Effect.succeed(
          Message.cases.Completed.make({
            request: model.request,
            result: { _tag: 'Page', page }
          })
        )
      }
      return Effect.succeed(
        Message.cases.Failed.make({
          request: model.request,
          error: m.shell_demo_read_only()
        })
      )
    }
    return execute(model, action).pipe(
      Effect.map((result) =>
        Message.cases.Completed.make({ request: model.request, result })
      ),
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(
          Message.cases.Failed.make({
            request: model.request,
            error: error.message
          })
        )
      )
    )
  }
})
export const Ready = Command.define('Workspace.Ready', {
  messages: [Message.cases.Ready],
  execute: Effect.succeed(Message.cases.Ready.make({}))
})
export const DismissPopover = Command.define('Workspace.DismissPopover', {
  args: { id: Schema.String },
  messages: [Message.cases.Noop],
  execute: ({ id }) =>
    Effect.sync(() => {
      document.getElementById(id)?.hidePopover()
      return Message.cases.Noop.make({})
    })
})
export const Back = Command.define('Workspace.Back', {
  messages: [Message.cases.Noop],
  execute: Effect.sync(() => {
    window.history.back()
    return Message.cases.Noop.make({})
  })
})
export const Navigate = Command.define('Workspace.Query', {
  args: { url: Schema.String, replace: Schema.Boolean },
  messages: [Message.cases.Noop],
  execute: ({ url, replace }) =>
    Effect.gen(function* () {
      yield* Render.afterCommit
      if (replace) {
        window.history.replaceState(window.history.state, '', url)
      } else {
        window.history.pushState(window.history.state, '', url)
      }
      return Message.cases.Noop.make({})
    })
})
export const Copy = Command.define('Workspace.Copy', {
  args: { text: Schema.String, secret: Schema.Boolean },
  messages: [Message.cases.Copied],
  execute: ({ text, secret }) =>
    Effect.tryPromise({
      try: () => navigator.clipboard.writeText(text),
      catch: () => (secret ? m.secret_copy_failed() : m.evidence_copy_failed())
    }).pipe(
      Effect.map(() => Message.cases.Copied.make({ notice: m.copy_success() })),
      Effect.catch((error) =>
        Effect.succeed(Message.cases.Copied.make({ notice: error }))
      )
    )
})

export const Prepare = Command.define('Workspace.Prepare', {
  args: { request: Schema.Number },
  messages: [Message.cases.Prepared],
  execute: ({ request }) =>
    Effect.sync(() =>
      Message.cases.Prepared.make({
        request,
        now: Date.now(),
        key: crypto.randomUUID()
      })
    )
})
