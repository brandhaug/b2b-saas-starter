import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { type HtmlBuilder, type Html } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import {
  PreferencesSchema,
  SetNotificationPreferenceSchema
} from '@/http/contracts/account-records'
import { loadOwnEmailDeliveryServerFnResponse } from '@/http/contracts/email-delivery'
import { setNotificationPreferenceServerFn } from '@/lib/server/notification-preferences'
import { formatDateTime } from '@/lib/format-date'
import { call } from '../server-call'
import { link } from '../shared/view'
import { feedback, panel, text } from './ui'
import * as Table from './table'

type Delivery = (typeof loadOwnEmailDeliveryServerFnResponse.Type)[number]
export function deliveryColumns<M>(): ReadonlyArray<Table.Column<Delivery, M>> {
  return [
    {
      id: 'providerMessageId',
      label: m.email_delivery_message_id(),
      kind: 'text',
      value: (row) => row.providerMessageId ?? row.id
    },
    {
      id: 'recipient',
      label: m.email_delivery_recipient(),
      kind: 'text',
      value: (row) => row.recipient
    },
    {
      id: 'purpose',
      label: m.email_delivery_purpose(),
      kind: 'select',
      value: (row) => row.purpose,
      options: [
        'verification',
        'recovery',
        'security',
        'invitation',
        'notification',
        'digest'
      ].map((value) => ({ value, label: purpose(value) })),
      cell: (row, h) => h.span([], [purpose(row.purpose)])
    },
    {
      id: 'status',
      label: m.status(),
      kind: 'select',
      value: (row) => row.status,
      options: [
        'accepted',
        'delivered',
        'temporary_failure',
        'delayed',
        'failed',
        'suppressed',
        'ambiguous',
        'logged',
        'queued'
      ].map((value) => ({ value, label: status(value) })),
      cell: (row, h) =>
        h.div(
          [h.Class('grid gap-1')],
          [
            h.span(
              [],
              [row.unconfirmed ? m.email_delivery_unconfirmed() : status(row.status)]
            ),
            ...(reason(row.reason) ? [text(h, reason(row.reason))] : [])
          ]
        )
    },
    {
      id: 'updatedAt',
      label: m.email_delivery_updated(),
      kind: 'date',
      value: (row) => row.updatedAt,
      cell: (row, h) =>
        h.span([h.Class('font-mono tabular-nums')], [formatDateTime(row.updatedAt)])
    }
  ]
}
export function purpose(value: string): string {
  switch (value) {
    case 'verification': {
      return m.email_delivery_verification()
    }
    case 'recovery': {
      return m.email_delivery_recovery()
    }
    case 'security': {
      return m.email_delivery_security()
    }
    case 'invitation': {
      return m.email_delivery_invitation()
    }
    case 'notification': {
      return m.email_delivery_notification()
    }
    case 'digest': {
      return m.email_delivery_digest()
    }
    default: {
      return value
    }
  }
}
export function status(value: string): string {
  switch (value) {
    case 'accepted': {
      return m.email_delivery_accepted()
    }
    case 'delivered': {
      return m.email_delivery_delivered()
    }
    case 'temporary_failure':
    case 'delayed': {
      return m.email_delivery_delayed()
    }
    case 'failed': {
      return m.email_delivery_failed()
    }
    case 'suppressed': {
      return m.email_delivery_suppressed()
    }
    case 'ambiguous': {
      return m.email_delivery_ambiguous()
    }
    case 'logged': {
      return m.email_delivery_logged()
    }
    case 'queued': {
      return m.email_delivery_queued()
    }
    default: {
      return value
    }
  }
}
export function reason(value: string | null): string {
  switch (value) {
    case null: {
      return ''
    }
    case 'hard_bounce': {
      return m.email_delivery_reason_hard_bounce()
    }
    case 'complaint': {
      return m.email_delivery_reason_complaint()
    }
    case 'provider_suppressed': {
      return m.email_delivery_reason_suppressed()
    }
    case 'provider_rejected': {
      return m.email_delivery_reason_rejected()
    }
    case 'temporary_failure': {
      return m.email_delivery_reason_temporary()
    }
    case 'transport_unavailable': {
      return m.email_delivery_reason_unavailable()
    }
    case 'timeout': {
      return m.email_delivery_reason_timeout()
    }
    case 'retry_window_expired': {
      return m.email_delivery_reason_expired()
    }
    case 'no_longer_relevant': {
      return m.email_delivery_reason_irrelevant()
    }
    default: {
      return ''
    }
  }
}
export const Model = Schema.Struct({
  preferences: PreferencesSchema,
  deliveries: loadOwnEmailDeliveryServerFnResponse,
  highlight: Schema.NullOr(Schema.String),
  pending: Schema.NullOr(Schema.String),
  ready: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  table: Table.Model
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: {},
  Selected: {
    kind: SetNotificationPreferenceSchema.fields.kind,
    channel: SetNotificationPreferenceSchema.fields.channel
  },
  Saved: { row: SetNotificationPreferenceSchema },
  Failed: { error: Schema.String },
  Table: { message: Table.Message }
})
export type Message = typeof Message.Type
const Save = Command.define('AccountNotifications.Save', {
  args: {
    kind: SetNotificationPreferenceSchema.fields.kind,
    channel: SetNotificationPreferenceSchema.fields.channel
  },
  messages: [Message.cases.Saved, Message.cases.Failed],
  execute: (data) =>
    call(
      () => setNotificationPreferenceServerFn({ data }),
      m.notification_preference_save_failed()
    ).pipe(
      Effect.map((row) => Message.cases.Saved.make({ row })),
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Message.cases.Failed.make({ error: error.message }))
      )
    )
})
export function init(
  preferences: typeof PreferencesSchema.Type,
  deliveryRows: typeof loadOwnEmailDeliveryServerFnResponse.Type,
  search: string
): Update.Return<Model, Message> {
  return {
    model: {
      preferences,
      deliveries: deliveryRows,
      highlight: new URLSearchParams(search).get('kind'),
      pending: null,
      ready: false,
      error: null,
      table: Table.init('email-deliveries', search, deliveryColumns())
    }
  }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Ready': {
      return { model: { ...model, ready: true } }
    }
    case 'Selected': {
      return !model.ready || model.pending !== null
        ? { model }
        : {
            model: { ...model, pending: message.kind, error: null },
            commands: [Save({ kind: message.kind, channel: message.channel })]
          }
    }
    case 'Saved': {
      return {
        model: {
          ...model,
          pending: null,
          preferences: model.preferences.map((row) =>
            row.kind === message.row.kind ? message.row : row
          )
        }
      }
    }
    case 'Failed': {
      return { model: { ...model, pending: null, error: message.error } }
    }
    case 'Table': {
      const result = Table.update(model.table, message.message)
      return {
        model: { ...model, table: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, (child): Message => ({
            _tag: 'Table',
            message: child
          }))
        )
      }
    }
  }
}
export function deliveries<M>(
  h: HtmlBuilder<M>,
  table: Table.Model,
  rows: typeof loadOwnEmailDeliveryServerFnResponse.Type,
  wrap: (message: Table.Message) => NoInfer<M>
): Html {
  return panel(h, m.email_delivery_title(), m.email_delivery_description(), [
    Table.view(
      table,
      h,
      wrap,
      rows,
      deliveryColumns(),
      m.email_delivery_title(),
      m.email_delivery_empty(),
      10
    ),
    text(h, m.email_delivery_warning())
  ])
}
export function view(
  model: Model,
  h: HtmlBuilder<Message>,
  showDeliveries: boolean
): Html {
  const highlighted = model.preferences.find((row) => row.kind === model.highlight)
  return h.div(
    [h.Class('grid gap-6')],
    [
      ...(highlighted && showDeliveries
        ? [
            h.p(
              [h.Role('status'), h.Class('border border-border p-4 text-sm')],
              [m.notification_email_link_notice({ label: highlighted.label })]
            )
          ]
        : []),
      panel(
        h,
        m.panel_email_notifications(),
        m.panel_email_notifications_description(),
        [
          feedback(h, model.error),
          h.ul(
            [h.Class('divide-y divide-border')],
            model.preferences.map((row) =>
              h.li(
                [
                  h.Attribute('data-kind', row.kind),
                  h.Class(
                    `grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[1fr_auto] md:items-center ${row.kind === model.highlight ? 'bg-accent/40 px-3' : ''}`
                  )
                ],
                [
                  h.div(
                    [h.Class('grid gap-1')],
                    [
                      h.p(
                        [h.Class('text-sm font-medium')],
                        [
                          row.label,
                          ...(row.security
                            ? [
                                h.span(
                                  [h.Class('ml-2 border border-border px-2 text-xs')],
                                  [m.security_label()]
                                )
                              ]
                            : []),
                          ...(row.isDefault
                            ? [
                                h.span(
                                  [h.Class('ml-2 text-xs text-muted-foreground')],
                                  [m.default_label()]
                                )
                              ]
                            : [])
                        ]
                      ),
                      text(h, row.description)
                    ]
                  ),
                  h.fieldset(
                    [
                      h.AriaLabel(`${row.label} email channel`),
                      h.Disabled(!model.ready || model.pending !== null),
                      h.Class('flex flex-wrap gap-3')
                    ],
                    [
                      { value: 'off' as const, label: m.notification_channel_off() },
                      {
                        value: 'instant' as const,
                        label: m.notification_channel_instant()
                      },
                      {
                        value: 'digest' as const,
                        label: m.notification_channel_digest()
                      }
                    ].map((channel) =>
                      h.label(
                        [h.Class('flex min-h-11 items-center gap-2 text-sm')],
                        [
                          h.input([
                            h.Type('radio'),
                            h.Name(`channel-${row.kind}`),
                            h.Value(channel.value),
                            h.Checked(row.channel === channel.value),
                            h.OnClick({
                              _tag: 'Selected',
                              kind: row.kind,
                              channel: channel.value
                            })
                          ]),
                          channel.label
                        ]
                      )
                    )
                  )
                ]
              )
            )
          ),
          text(h, m.notification_delivery_explanation()),
          link(
            h,
            showDeliveries ? '/account' : '/account/notifications',
            showDeliveries ? m.back_to_account() : m.email_delivery_title()
          )
        ]
      ),
      ...(showDeliveries
        ? [
            deliveries(h, model.table, model.deliveries, (message): Message => ({
              _tag: 'Table',
              message
            }))
          ]
        : [])
    ]
  )
}
