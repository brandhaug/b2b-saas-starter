import { m } from '@b2b-saas-starter/i18n/messages'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { type Model, type Message } from './model'
import { button, field } from './ui'
import * as Dashboard from './dashboard'
import * as Members from './members'
import * as Settings from './settings'
import * as Tokens from './tokens'
import * as Webhooks from './webhooks'
import * as Billing from './billing'
import * as Audit from './audit'
import * as Assistant from './assistant'
import * as Suspended from './suspended'
import * as Notifications from './notifications'
import { allowedDialog } from './authorization'
export { Flags, Model, Message } from './model'
export { flagsForPage } from './flags'
export { init, update } from './update'
export { subscriptions, managedResources } from './resources'

function dialogTitle(model: Model): string {
  if (model.confirmation) {
    return model.dialog ?? ''
  }
  switch (model.dialog) {
    case 'invite': {
      return m.form_invite_member()
    }
    case 'token': {
      return m.form_create_token()
    }
    case 'webhook': {
      return m.webhook_create_action()
    }
    case 'deliveries': {
      return m.webhook_delivery()
    }
    case 'sso': {
      return m.sso_title()
    }
    case null: {
      return m.audit_event()
    }
    default: {
      return m.audit_event()
    }
  }
}

function confirmationLabel(model: Model, title: string): string {
  const labels: Partial<Record<NonNullable<Model['confirmation']>['_tag'], string>> = {
    DeleteWorkspace: m.delete_workspace_permanently(),
    RemoveMember: m.action_confirm_remove(),
    RevokeToken: m.action_confirm_revoke(),
    Leave: m.action_confirm_leave(),
    ToggleWebhook: m.confirm_disable()
  }
  return model.confirmation ? (labels[model.confirmation._tag] ?? title) : title
}

function dialogContent(model: Model, h: HtmlBuilder<Message>): Html {
  switch (model.dialog) {
    case 'invite': {
      return Members.invitationForm(model, h)
    }
    case 'token': {
      return Tokens.form(model, h)
    }
    case 'webhook': {
      return Webhooks.form(model, h)
    }
    case 'deliveries': {
      return Webhooks.deliveries(model, h)
    }
    case 'sso': {
      return Settings.ssoForm(model, h)
    }
    case null: {
      return Audit.detail(model, h)
    }
    default: {
      return Audit.detail(model, h)
    }
  }
}

export function view(model: Model, h: HtmlBuilder<Message>): Html {
  if (model.dialog && !allowedDialog(model, model.dialog)) {
    return view({ ...model, dialog: null }, h)
  }
  let content: Html
  const pageModel =
    model.dialog === null
      ? model
      : { ...model, error: null, notice: null, secret: null }
  switch (model.page._tag) {
    case 'dashboard': {
      content = new URL(model.url).pathname.endsWith('/notifications')
        ? h.div(
            [h.Class('grid gap-6')],
            [
              h.h1([h.Class('text-2xl font-semibold')], [m.notifications_title()]),
              Notifications.view(model, h)
            ]
          )
        : Dashboard.view(pageModel, h)
      break
    }
    case 'members': {
      content = Members.view(pageModel, h)
      break
    }
    case 'settings': {
      content = Settings.view(pageModel, h)
      break
    }
    case 'api-tokens': {
      content = Tokens.view(pageModel, h)
      break
    }
    case 'webhooks': {
      content = Webhooks.view(pageModel, h)
      break
    }
    case 'billing': {
      content = Billing.view(pageModel, h)
      break
    }
    case 'audit': {
      content = Audit.view(pageModel, h)
      break
    }
    case 'assistant': {
      content = Assistant.view(pageModel, h)
      break
    }
    case 'suspended': {
      content = Suspended.view(pageModel, h)
      break
    }
  }
  const title = dialogTitle(model)
  return h.div(
    [h.Class('grid gap-6')],
    [
      content,
      ...(model.dialog === null
        ? []
        : [
            h.dialog(
              [
                h.Id('workspace-dialog'),
                ...(model.dialog === 'audit'
                  ? [
                      h.Attribute(
                        'data-audit-event',
                        new URL(model.url).searchParams.get('event') ?? ''
                      )
                    ]
                  : []),
                h.Role(model.confirmation ? 'alertdialog' : 'dialog'),
                ...(model.confirmation ? [] : [h.Attribute('data-side', 'right')]),
                ...(model.dialogClosing ? [h.Attribute('data-ending-style', '')] : []),
                h.Attribute('aria-labelledby', 'workspace-dialog-title'),
                h.Class(
                  `${model.confirmation ? 'ui-popup' : 'ui-sheet'} fixed inset-0 m-auto max-h-[90dvh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto border border-border bg-popover p-6 text-popover-foreground backdrop:bg-overlay/80`
                )
              ],
              [
                h.div(
                  [
                    h.Class(
                      'grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 break-words [&>button]:min-w-0 [&>button]:whitespace-normal'
                    )
                  ],
                  [
                    h.h2(
                      [
                        h.Id('workspace-dialog-title'),
                        h.Class('text-lg font-semibold')
                      ],
                      [title]
                    ),
                    ...(model.confirmation
                      ? [
                          ...(model.confirmation._tag === 'RemoveMember' &&
                          model.page._tag === 'members'
                            ? [
                                h.p(
                                  [],
                                  [
                                    m.members_remove_description({
                                      name:
                                        model.page.data.members.find(
                                          (member) =>
                                            model.confirmation?._tag ===
                                              'RemoveMember' &&
                                            member.id === model.confirmation.userId
                                        )?.name ?? ''
                                    })
                                  ]
                                )
                              ]
                            : []),
                          ...(model.confirmation._tag === 'DeleteWorkspace'
                            ? [
                                h.p([], [m.delete_workspace_confirm_description()]),
                                field(
                                  h,
                                  'delete-workspace-confirm',
                                  m.type_slug_to_confirm({ slug: model.flags.slug }),
                                  model.settings.confirmation,
                                  (value) => ({
                                    _tag: 'SettingField',
                                    field: 'confirmation',
                                    value
                                  })
                                )
                              ]
                            : []),
                          button(
                            h,
                            confirmationLabel(model, title),
                            { _tag: 'Confirmed' },
                            model.pending ||
                              (model.confirmation._tag === 'DeleteWorkspace' &&
                                model.settings.confirmation.trim() !== model.flags.slug)
                          )
                        ]
                      : [dialogContent(model, h)]),
                    h.button(
                      [
                        h.Id('workspace-dialog-close'),
                        h.Type('button'),
                        h.Class('min-h-11 rounded-md border px-4 py-2 text-sm'),
                        h.OnClick({ _tag: 'Close' })
                      ],
                      [model.confirmation ? m.common_cancel() : m.common_close()]
                    )
                  ]
                )
              ]
            )
          ])
    ]
  )
}
