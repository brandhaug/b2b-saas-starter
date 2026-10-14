import { Schema } from 'effect'
import { Domain, Identifier, PageInfo, envelope } from './api.ts'

// Source wire contract: Wrangler 4.149.0 src/queues/subscription-types.ts.
// https://developers.cloudflare.com/email-service/platform/event-subscriptions/
export const events = [
  'message.delivered',
  'message.deferred',
  'message.bounced',
  'message.failed',
  'message.rejected',
  'message.complained'
]
export const EmailSendingSubscriptionProps = Schema.Struct({
  accountId: Identifier,
  zoneId: Identifier,
  domain: Domain,
  // Queue changes replace the subscription to preserve exact ownership checks.
  queueId: Identifier,
  // Deterministic stack/stage/resource name permits interrupted-create recovery.
  name: Schema.NonEmptyString
})
export type EmailSendingSubscriptionProps = Schema.Schema.Type<
  typeof EmailSendingSubscriptionProps
>
export type EmailSendingSubscriptionAttributes = EmailSendingSubscriptionProps & {
  readonly subscriptionId: string
  readonly events: ReadonlyArray<string>
  readonly enabled: boolean
}
export const decodeProps = Schema.decodeEffect(EmailSendingSubscriptionProps)
export const Subscription = Schema.Struct({
  id: Identifier,
  name: Schema.NonEmptyString,
  enabled: Schema.Boolean,
  events: Schema.Array(Schema.String),
  // Account-wide lists also include unrelated products.
  source: Schema.Struct({
    type: Schema.String,
    zone_id: Schema.optionalKey(Identifier),
    domain: Schema.optionalKey(Schema.String)
  }).check(
    Schema.makeFilter(
      (source) =>
        source.type !== 'email.sending' ||
        (source.zone_id !== undefined && source.domain !== undefined)
    )
  ),
  destination: Schema.Struct({
    type: Schema.Literal('queues.queue'),
    queue_id: Identifier
  })
})
export type Subscription = Schema.Schema.Type<typeof Subscription>
export const SubscriptionPage = Schema.Struct({
  success: Schema.Literal(true),
  result: Schema.Array(Subscription),
  result_info: PageInfo
})
export const Queue = envelope(Schema.Struct({ queue_id: Identifier }))
export const SubscriptionResponse = envelope(Subscription)
export const Deleted = Schema.Struct({ success: Schema.Literal(true) })
export const Mutation = Schema.Struct({
  name: Schema.NonEmptyString,
  enabled: Schema.Literal(true),
  events: Schema.Array(Schema.String),
  destination: Schema.Struct({
    type: Schema.Literal('queues.queue'),
    queue_id: Identifier
  })
})
export const Creation = Schema.Struct({
  ...Mutation.fields,
  source: Schema.Struct({
    type: Schema.Literal('email.sending'),
    zone_id: Identifier,
    domain: Domain
  })
})

export function sameSource(value: Subscription, props: EmailSendingSubscriptionProps) {
  return (
    value.source.type === 'email.sending' &&
    value.source.zone_id === props.zoneId &&
    value.source.domain === props.domain
  )
}
export function sameEvents(value: ReadonlyArray<string>) {
  return (
    value.length === events.length && events.every((event) => value.includes(event))
  )
}
export function attributes(
  value: Subscription,
  props: EmailSendingSubscriptionProps
): EmailSendingSubscriptionAttributes {
  return {
    ...props,
    subscriptionId: value.id,
    name: value.name,
    queueId: value.destination.queue_id,
    events: value.events,
    enabled: value.enabled
  }
}
