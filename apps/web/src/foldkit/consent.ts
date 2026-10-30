import { Effect, Schema } from 'effect'
import { navigateDocument } from '@/lib/document-navigation'
import { Command, type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { loadOAuthConsentServerFnResponse } from '@/http/contracts/mcp-consent'
import {
  denyOAuthConsentServerFn,
  grantOAuthConsentServerFn
} from '@/lib/server/mcp-consent'
import { consentRequest, scopeLabel } from '@/lib/oauth-query'
import { m } from '@b2b-saas-starter/i18n/messages'
import { shell } from './auth/view'
import { call } from './server-call'

export const Flags = Schema.Struct({
  payload: loadOAuthConsentServerFnResponse,
  search: Schema.String
})
export type Flags = typeof Flags.Type
export const Model = Schema.Struct({
  flags: Flags,
  workspaceId: Schema.NullOr(Schema.String),
  pending: Schema.NullOr(Schema.Literals(['grant', 'deny'])),
  error: Schema.NullOr(Schema.String),
  ready: Schema.Boolean
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: {},
  PickedWorkspace: { id: Schema.String },
  Decided: { action: Schema.Literals(['grant', 'deny']) },
  Failed: { error: Schema.String },
  Redirected: {}
})
export type Message = typeof Message.Type
const Ready = Command.define('Consent.Ready', {
  messages: [Message.cases.Ready],
  execute: Effect.succeed(Message.cases.Ready.make({}))
})
const Decide = Command.define('Consent.Decide', {
  args: {
    oauthQuery: Schema.String,
    workspaceId: Schema.NullOr(Schema.String),
    action: Schema.Literals(['grant', 'deny'])
  },
  messages: [Message.cases.Failed, Message.cases.Redirected],
  execute: ({ oauthQuery, workspaceId, action }) =>
    Effect.gen(function* () {
      if (action === 'grant' && workspaceId === null) {
        return Message.cases.Failed.make({ error: m.oauth_pick_workspace() })
      }
      const result = yield* action === 'deny'
        ? call(
            () => denyOAuthConsentServerFn({ data: { oauthQuery } }),
            m.oauth_deny_failed()
          )
        : call(
            () =>
              grantOAuthConsentServerFn({
                data: { workspaceId: workspaceId ?? '', oauthQuery }
              }),
            m.oauth_grant_failed()
          )
      yield* Effect.sync(() => navigateDocument(result.url))
      return Message.cases.Redirected.make({})
    }).pipe(
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Message.cases.Failed.make({ error: error.message }))
      )
    )
})

export function init(flags: Flags): Update.Return<Model, Message> {
  return {
    model: {
      flags,
      workspaceId:
        flags.payload.workspaces.length === 1
          ? (flags.payload.workspaces[0]?.workspace.id ?? null)
          : null,
      pending: null,
      error: null,
      ready: false
    },
    commands: [Ready()]
  }
}

export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Ready': {
      return { model: { ...model, ready: true } }
    }
    case 'PickedWorkspace': {
      return model.pending === null &&
        model.flags.payload.workspaces.some(
          ({ workspace }) => workspace.id === message.id
        )
        ? { model: { ...model, workspaceId: message.id } }
        : { model }
    }
    case 'Failed': {
      return { model: { ...model, pending: null, error: message.error } }
    }
    case 'Redirected': {
      return { model }
    }
    case 'Decided': {
      if (!model.ready || model.pending !== null) {
        return { model }
      }
      const oauthQuery = model.flags.payload.oauthQuery
      if (oauthQuery === null) {
        return { model: { ...model, error: m.oauth_request_missing() } }
      }
      if (message.action === 'grant' && model.workspaceId === null) {
        return { model: { ...model, error: m.oauth_pick_workspace() } }
      }
      return {
        model: { ...model, pending: message.action, error: null },
        commands: [
          Decide({ oauthQuery, workspaceId: model.workspaceId, action: message.action })
        ]
      }
    }
  }
}

export function view(model: Model, h: HtmlBuilder<Message>): Html {
  const { payload, search } = model.flags
  const params = new URLSearchParams(search)
  const request = consentRequest({
    client_id: params.get('client_id') ?? undefined,
    scope: params.get('scope') ?? undefined
  })
  const client = payload.client?.name ?? request?.clientId ?? m.oauth_unnamed_client()
  const resources = new URLSearchParams(payload.oauthQuery ?? '').getAll('resource')
  function section(id: string, title: string, children: Array<Html>) {
    return h.section(
      [h.Class('grid gap-2'), h.Attribute('aria-labelledby', id)],
      [h.h2([h.Id(id), h.Class('text-sm font-semibold')], [title]), ...children]
    )
  }
  function p(value: string) {
    return h.p([h.Class('text-sm text-muted-foreground')], [value])
  }
  const body = h.main(
    [
      h.Id('main-content'),
      h.Tabindex(-1),
      h.Class(
        'mx-auto grid w-full max-w-md flex-1 place-items-center px-4 py-12 outline-none'
      )
    ],
    [
      h.div(
        [h.Class('grid w-full gap-4 border border-border bg-card p-6')],
        [
          h.h1([h.Class('text-lg font-semibold')], [m.oauth_connect_title({ client })]),
          p(
            payload.client?.uri
              ? m.oauth_connect_with_uri({ uri: payload.client.uri })
              : m.oauth_connect_without_uri()
          ),
          model.error
            ? h.p([h.Role('alert'), h.Class('text-sm text-destructive')], [model.error])
            : null,
          request === null
            ? h.p([h.Role('alert')], [m.oauth_request_missing()])
            : h.div(
                [h.Class('grid gap-4')],
                [
                  section('consent-client', m.oauth_client_id(), [
                    h.p(
                      [
                        h.Class('break-all font-mono text-sm'),
                        h.Attribute('dir', 'ltr')
                      ],
                      [payload.client?.clientId ?? request.clientId]
                    ),
                    p(m.oauth_client_identity_note())
                  ]),
                  section('consent-workspace', m.oauth_workspace(), [
                    payload.workspaces.length === 0
                      ? p(m.oauth_no_membership())
                      : h.fieldset(
                          [
                            h.Disabled(!model.ready || model.pending !== null),
                            h.AriaLabel(m.oauth_workspace()),
                            h.Class('grid gap-2')
                          ],
                          payload.workspaces.map(({ workspace, memberCount }) =>
                            h.label(
                              [
                                h.Class(
                                  'flex items-start gap-3 border border-border px-3 py-2 has-checked:border-primary'
                                )
                              ],
                              [
                                h.input([
                                  h.Type('radio'),
                                  h.Name('workspace'),
                                  h.Value(workspace.id),
                                  h.Checked(model.workspaceId === workspace.id),
                                  h.OnChange(() =>
                                    Message.cases.PickedWorkspace.make({
                                      id: workspace.id
                                    })
                                  )
                                ]),
                                h.span(
                                  [h.Class('grid gap-0.5')],
                                  [
                                    h.span([h.Class('text-sm')], [workspace.name]),
                                    h.span(
                                      [h.Class('text-xs text-muted-foreground')],
                                      [
                                        `${workspace.slug} · ${memberCount} ${m.oauth_member_count({ count: memberCount })}`
                                      ]
                                    )
                                  ]
                                )
                              ]
                            )
                          )
                        ),
                    p(m.oauth_role_scope())
                  ]),
                  resources.length
                    ? section('consent-resources', m.oauth_resources(), [
                        h.ul(
                          [h.Class('grid gap-1 text-sm')],
                          resources.map((resource) =>
                            h.li([h.Class('break-all font-mono text-xs')], [resource])
                          )
                        )
                      ])
                    : null,
                  section('consent-scopes', m.oauth_client_asks(), [
                    h.ul(
                      [h.Class('grid gap-1 text-sm')],
                      request.scopes.map((scope) =>
                        h.li(
                          [],
                          [
                            scopeLabel(scope),
                            ' ',
                            h.span(
                              [h.Class('font-mono text-xs text-muted-foreground')],
                              [scope]
                            )
                          ]
                        )
                      )
                    )
                  ]),
                  h.div(
                    [h.Class('flex flex-wrap justify-end gap-2')],
                    (['deny', 'grant'] as const).map((action) =>
                      h.button(
                        [
                          h.Type('button'),
                          h.Class(
                            'min-h-11 rounded-md border border-input px-4 py-2 text-sm disabled:opacity-50'
                          ),
                          h.Disabled(
                            !model.ready ||
                              model.pending !== null ||
                              payload.oauthQuery === null ||
                              (action === 'grant' && model.workspaceId === null)
                          ),
                          h.OnClick(Message.cases.Decided.make({ action }))
                        ],
                        [action === 'grant' ? m.oauth_allow() : m.oauth_decline()]
                      )
                    )
                  )
                ]
              )
        ]
      )
    ]
  )
  return shell(h, body, false, null)
}
