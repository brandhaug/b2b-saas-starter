import { Schema } from 'effect'

/**
 * One instant-email job: which Notification, for which recipient. The
 * background consumer imports this schema, so producer and consumer share one
 * wire shape — the same arrangement as `WebhookQueueMessage`.
 *
 * The message carries ids only. The consumer re-reads the Notification, the
 * recipient's address, and the recipient's current channel preference at send
 * time, so a preference changed between enqueue and delivery is honoured and
 * no email body or address sits in the queue.
 */
export const NotificationEmailQueueMessage = Schema.Struct({
  notificationId: Schema.String,
  recipientUserId: Schema.String,
  // Unchecked string on purpose, as on the webhook message: a strict W3C
  // pattern would turn a cosmetic trace defect into a dropped email.
  traceparent: Schema.optionalKey(Schema.String)
})
export type NotificationEmailQueueMessage = typeof NotificationEmailQueueMessage.Type

/**
 * Structural subset of Cloudflare's `Queue` binding, resolving to `void` for
 * the same reason `WebhookQueueBinding` does: enqueueing either happened or
 * rejected, and nothing reads the platform's response. Every worker env types
 * `NOTIFICATION_EMAIL_QUEUE` with this port, never workers-types' `Queue`.
 */
export type NotificationEmailQueueBinding = {
  readonly send: (message: NotificationEmailQueueMessage) => Promise<void>
  readonly sendBatch: (
    messages: Iterable<{ readonly body: NotificationEmailQueueMessage }>
  ) => Promise<void>
}
