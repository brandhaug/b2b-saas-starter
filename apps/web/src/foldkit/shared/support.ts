import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import { buttonClass, icon } from './view'

export const Flags = Schema.Struct({
  routeName: Schema.Literals(['help', 'workspace', 'application']),
  workspaceId: Schema.NullOr(Schema.String),
  appVersion: Schema.NullOr(Schema.String)
})
export type Flags = typeof Flags.Type
export const Model = Schema.Struct({
  flags: Flags,
  status: Schema.Literals(['idle', 'copying', 'copied', 'failed'])
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Requested: {},
  Completed: { success: Schema.Boolean }
})
export type Message = typeof Message.Type
const Copy = Command.define('Support.Copy', {
  args: { flags: Flags },
  messages: [Message.cases.Completed],
  execute: ({ flags }) =>
    Effect.tryPromise({
      try: () => {
        const lines = [
          `Time (UTC): ${new Date().toISOString()}`,
          `Route: ${flags.routeName}`
        ]
        if (flags.appVersion) {
          lines.push(`App version: ${flags.appVersion}`)
        }
        if (flags.workspaceId) {
          lines.push(`Workspace ID: ${flags.workspaceId}`)
        }
        return navigator.clipboard.writeText(lines.join('\n'))
      },
      catch: () => Message.cases.Completed.make({ success: false })
    }).pipe(
      Effect.map(() => Message.cases.Completed.make({ success: true })),
      Effect.catch((error) => Effect.succeed(error))
    )
})
export function init(flags: Flags): Update.Return<Model, Message> {
  return { model: { flags, status: 'idle' } }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  if (message._tag === 'Completed') {
    return { model: { ...model, status: message.success ? 'copied' : 'failed' } }
  }
  if (model.status === 'copying') {
    return { model }
  }
  return {
    model: { ...model, status: 'copying' },
    commands: [Copy({ flags: model.flags })]
  }
}
export function view(model: Model, h: HtmlBuilder<Message>): Html {
  let status = ''
  if (model.status === 'copied') {
    status = m.support_details_copied()
  }
  if (model.status === 'failed') {
    status = m.support_details_copy_failed()
  }
  return h.div(
    [h.Class('grid justify-items-start gap-2')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class(buttonClass),
          h.Disabled(model.status === 'copying'),
          h.OnClick(Message.cases.Requested.make({}))
        ],
        [icon(h, 'copy'), m.support_copy_details()]
      ),
      h.output(
        [h.Attribute('aria-live', 'polite'), h.Class('text-sm text-muted-foreground')],
        [status]
      )
    ]
  )
}
