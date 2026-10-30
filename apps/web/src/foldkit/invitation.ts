import { Effect, Schema } from 'effect'
import { navigateDocument } from '@/lib/document-navigation'
import { Command, type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { invitationPreviewServerFnResponse } from '@/http/contracts/invitations'
import { acceptInvitationServerFn } from '@/lib/server/invitations'
import { roleLabel } from '@/lib/value-labels'
import { m } from '@b2b-saas-starter/i18n/messages'
import { shell } from './auth/view'
import { call } from './server-call'

export const Flags = invitationPreviewServerFnResponse
export type Flags = typeof Flags.Type
export const Model = Schema.Struct({
  preview: Flags,
  ready: Schema.Boolean,
  pending: Schema.Boolean,
  error: Schema.NullOr(Schema.String)
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: {},
  Accepted: {},
  Failed: { error: Schema.String },
  Redirected: {}
})
export type Message = typeof Message.Type
const Ready = Command.define('Invitation.Ready', {
  messages: [Message.cases.Ready],
  execute: Effect.succeed(Message.cases.Ready.make({}))
})
const Accept = Command.define('Invitation.Accept', {
  args: { invitationId: Schema.String },
  messages: [Message.cases.Failed, Message.cases.Redirected],
  execute: ({ invitationId }) =>
    call(
      () => acceptInvitationServerFn({ data: { invitationId } }),
      m.accept_invitation_failed()
    ).pipe(
      Effect.map((joined) => {
        navigateDocument(`/workspaces/${encodeURIComponent(joined.workspaceSlug)}`)
        return Message.cases.Redirected.make({})
      }),
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Message.cases.Failed.make({ error: error.message }))
      )
    )
})

export function init(preview: Flags): Update.Return<Model, Message> {
  return {
    model: { preview, ready: false, pending: false, error: null },
    commands: [Ready()]
  }
}

export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Ready': {
      return { model: { ...model, ready: true } }
    }
    case 'Failed': {
      return { model: { ...model, error: message.error, pending: false } }
    }
    case 'Redirected': {
      return { model }
    }
    case 'Accepted': {
      return !model.ready || model.pending || model.preview.state !== 'pending'
        ? { model }
        : {
            model: { ...model, pending: true, error: null },
            commands: [Accept({ invitationId: model.preview.invitationId })]
          }
    }
  }
}

export function view(model: Model, h: HtmlBuilder<Message>): Html {
  const { preview } = model
  const unavailable = preview.state === 'unavailable'
  return shell(
    h,
    h.main(
      [
        h.Id('main-content'),
        h.Tabindex(-1),
        h.Class(
          'mx-auto grid w-full max-w-lg flex-1 place-items-center px-4 py-12 outline-none'
        )
      ],
      [
        h.div(
          [h.Class('grid w-full gap-4 border border-border bg-card p-6')],
          [
            h.h1(
              [h.Class('text-lg font-semibold')],
              [
                unavailable
                  ? m.invitation_link_unusable()
                  : m.join_workspace_title({ workspace: preview.workspaceName })
              ]
            ),
            h.p(
              [h.Class('text-sm text-muted-foreground')],
              [
                unavailable
                  ? m.invitation_unusable_description()
                  : m.invitation_accept_description({
                      workspace: preview.workspaceName,
                      role: roleLabel(preview.role)
                    })
              ]
            ),
            model.error
              ? h.p(
                  [h.Role('alert'), h.Class('text-sm text-destructive')],
                  [model.error]
                )
              : null,
            h.div(
              [h.Class('flex items-center gap-3')],
              [
                unavailable
                  ? null
                  : h.button(
                      [
                        h.Type('button'),
                        h.Disabled(!model.ready || model.pending),
                        h.Class(
                          'min-h-11 rounded-md border border-input px-4 py-2 text-sm disabled:opacity-50'
                        ),
                        h.OnClick(Message.cases.Accepted.make({}))
                      ],
                      [m.accept_invitation_action()]
                    ),
                h.a(
                  [
                    h.Href('/workspaces'),
                    h.Class(
                      'inline-flex min-h-11 items-center text-sm underline underline-offset-4'
                    )
                  ],
                  [unavailable ? m.go_to_workspaces() : m.not_now_action()]
                )
              ]
            )
          ]
        )
      ]
    ),
    false,
    null
  )
}
