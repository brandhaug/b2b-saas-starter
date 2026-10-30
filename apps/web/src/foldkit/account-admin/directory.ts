import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { loadWorkspaceDirectoryServerFnResponse } from '@/http/contracts/workspace-directory'
import { loadPurchaseServerFnResponse } from '@/http/contracts/purchase'
import { createWorkspaceServerFn } from '@/lib/server/workspace-lifecycle'
import { validateWorkspaceName } from '@/lib/workspace-name'
import { m } from '@b2b-saas-starter/i18n/messages'
import { call } from '../server-call'
import { link, buttonClass, icon } from '../shared/view'
import { button, feedback, field, form, heading, panel, text } from './ui'

export const Flags = Schema.Struct({
  purchasePage: Schema.Boolean,
  validIntent: Schema.Boolean,
  purchase: Schema.NullOr(loadPurchaseServerFnResponse),
  directory: loadWorkspaceDirectoryServerFnResponse
})
export type Flags = typeof Flags.Type
export const Model = Schema.Struct({
  flags: Flags,
  ready: Schema.Boolean,
  name: Schema.String,
  slug: Schema.String,
  slugEdited: Schema.Boolean,
  createOpen: Schema.Boolean,
  pending: Schema.Boolean,
  error: Schema.NullOr(Schema.String)
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: {},
  Name: { value: Schema.String },
  Slug: { value: Schema.String },
  Opened: {},
  Closed: {},
  Create: {},
  Failed: { error: Schema.String },
  Created: {}
})
export type Message = typeof Message.Type
const Create = Command.define('AccountDirectory.Create', {
  args: { model: Model },
  messages: [Message.cases.Failed, Message.cases.Created],
  execute: ({ model }) =>
    call(
      () => createWorkspaceServerFn({ data: { name: model.name, slug: model.slug } }),
      m.workspace_create_failed()
    ).pipe(
      Effect.map((workspace) => {
        window.location.assign(
          `/workspaces/${encodeURIComponent(workspace.slug)}${model.flags.purchasePage ? '/billing?purchase=team' : ''}`
        )
        return Message.cases.Created.make({})
      }),
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Message.cases.Failed.make({ error: error.message }))
      )
    )
})
export function init(flags: Flags): Update.Return<Model, Message> {
  return {
    model: {
      flags,
      ready: false,
      name: '',
      slug: '',
      slugEdited: false,
      createOpen: false,
      pending: false,
      error: null
    }
  }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Ready': {
      return { model: { ...model, ready: true } }
    }
    case 'Name': {
      return {
        model: {
          ...model,
          name: message.value,
          slug: model.slugEdited
            ? model.slug
            : message.value
                .toLowerCase()
                .replaceAll(/[^a-z0-9]+/g, '-')
                .replaceAll(/^-+|-+$/g, '')
                .slice(0, 40)
                .replaceAll(/-+$/g, '')
        }
      }
    }
    case 'Slug': {
      return { model: { ...model, slug: message.value, slugEdited: true } }
    }
    case 'Opened': {
      return { model: { ...model, createOpen: true } }
    }
    case 'Closed': {
      return model.pending ? { model } : { model: { ...model, createOpen: false } }
    }
    case 'Create': {
      if (!model.ready || model.pending) {
        return { model }
      }
      if (
        model.flags.purchasePage &&
        (!model.flags.validIntent || model.flags.purchase?.emailVerificationRequired)
      ) {
        return { model }
      }
      const error =
        validateWorkspaceName(model.name) ??
        (/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(model.slug)
          ? null
          : m.workspace_slug_hint())
      if (error) {
        return { model: { ...model, error } }
      }
      return {
        model: { ...model, pending: true, error: null },
        commands: [Create({ model })]
      }
    }
    case 'Failed': {
      return { model: { ...model, pending: false, error: message.error } }
    }
    case 'Created': {
      return { model: { ...model, pending: false } }
    }
  }
}
function createForm(model: Model, h: HtmlBuilder<Message>): Html {
  return h.div(
    [h.Class('grid gap-4')],
    [
      form(
        h,
        { _tag: 'Create' },
        m.form_create_workspace(),
        model.pending,
        model.ready,
        [
          field(
            h,
            'name',
            m.form_workspace_name(),
            model.name,
            (value): Message => ({
              _tag: 'Name',
              value
            }),
            'text',
            true,
            m.workspace_name_placeholder()
          ),
          field(
            h,
            'slug',
            m.form_workspace_url(),
            model.slug,
            (value): Message => ({
              _tag: 'Slug',
              value
            }),
            'text',
            true,
            m.workspace_slug_placeholder()
          )
        ]
      ),
      feedback(h, model.error)
    ]
  )
}
export function view(model: Model, h: HtmlBuilder<Message>): Html {
  const { flags } = model
  if (flags.purchasePage) {
    const purchase = flags.purchase
    return h.div(
      [h.Class('mx-auto grid w-full max-w-2xl gap-6 py-12')],
      [
        heading(
          h,
          flags.validIntent
            ? m.purchase_plan({ name: purchase?.plan?.name ?? 'Team' })
            : m.purchase_title(),
          flags.validIntent ? m.purchase_choose_workspace() : ''
        ),
        ...(purchase && flags.validIntent
          ? [
              ...(purchase.plan === null
                ? [text(h, m.billing_pricing_unavailable())]
                : []),
              ...(purchase.stripeConfigured
                ? []
                : [text(h, m.billing_not_configured())]),
              ...(purchase.emailVerificationRequired
                ? []
                : [
                    panel(h, m.page_workspaces(), '', [
                      h.div(
                        [h.Class('grid gap-3')],
                        purchase.workspaces.map((workspace) =>
                          h.a(
                            [
                              h.Href(
                                `/workspaces/${encodeURIComponent(workspace.slug)}/billing?purchase=team`
                              ),
                              h.Role('button'),
                              h.Class(buttonClass)
                            ],
                            [workspace.name]
                          )
                        )
                      ),
                      ...(purchase.workspaces.length
                        ? []
                        : [text(h, m.purchase_no_workspace())])
                    ]),
                    panel(h, m.workspaces_new_action(), '', [createForm(model, h)])
                  ])
            ]
          : [text(h, m.purchase_invalid())]),
        link(h, '/pricing', m.purchase_cancel())
      ]
    )
  }
  return h.div(
    [h.Class('grid gap-6')],
    [
      h.div(
        [h.Class('flex flex-wrap items-start justify-between gap-4')],
        [
          heading(h, m.page_workspaces(), m.page_workspaces_description()),
          ...(flags.directory.length
            ? [button(h, m.workspaces_new_action(), { _tag: 'Opened' }, !model.ready)]
            : [])
        ]
      ),
      panel(
        h,
        '',
        '',
        flags.directory.length
          ? [
              h.ul(
                [h.Class('grid gap-2')],
                flags.directory.map(({ workspace, memberCount, notificationCount }) =>
                  h.li(
                    [h.Class('border border-border')],
                    [
                      h.a(
                        [
                          h.Href(`/workspaces/${encodeURIComponent(workspace.slug)}`),
                          h.Class(
                            'flex w-full items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring'
                          )
                        ],
                        [
                          h.div(
                            [],
                            [
                              h.p([h.Class('text-sm font-medium')], [workspace.name]),
                              text(
                                h,
                                `${memberCount} ${m.members_count_label()}, ${notificationCount} ${m.notifications_count_label()}`
                              )
                            ]
                          ),
                          h.span(
                            [h.Class('-rotate-90 text-muted-foreground')],
                            [icon(h, 'chevron')]
                          )
                        ]
                      )
                    ]
                  )
                )
              )
            ]
          : [text(h, m.empty_no_workspace_membership()), createForm(model, h)]
      ),
      ...(model.createOpen
        ? [
            h.dialog(
              [
                h.Id('account-admin-create'),
                h.Attribute('aria-labelledby', 'create-workspace-title'),
                h.Class(
                  'fixed inset-y-0 right-0 left-auto m-0 ml-auto h-dvh max-h-dvh w-full max-w-lg overflow-y-auto border border-border bg-card p-6 text-foreground backdrop:bg-overlay/80'
                )
              ],
              [
                h.h2(
                  [
                    h.Id('create-workspace-title'),
                    h.Class('mb-5 text-lg font-semibold')
                  ],
                  [m.workspaces_new_action()]
                ),
                createForm(model, h),
                button(h, m.common_cancel(), { _tag: 'Closed' }, model.pending)
              ]
            )
          ]
        : [])
    ]
  )
}
