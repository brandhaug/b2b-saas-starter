import { Schema } from 'effect'

export const EmailDeliveryPurpose = Schema.Union([
  Schema.Literal('digest'),
  Schema.Literal('verification'),
  Schema.Literal('notification'),
  Schema.Literal('invitation'),
  Schema.Literal('recovery'),
  Schema.Literal('security')
])

export const EmailDeliveryStatus = Schema.Union([
  Schema.Literal('queued'),
  Schema.Literal('accepted'),
  Schema.Literal('delivered'),
  Schema.Literal('delayed'),
  Schema.Literal('failed'),
  Schema.Literal('suppressed'),
  Schema.Literal('ambiguous'),
  Schema.Literal('temporary_failure'),
  Schema.Literal('logged')
])

export const LoadSystemEmailDeliverySchema = Schema.Struct({
  resendAllowed: Schema.Boolean,
  unconfirmed: Schema.Boolean,
  id: Schema.String,
  referenceId: Schema.Union([Schema.Null, Schema.String]),
  purpose: EmailDeliveryPurpose,
  recipient: Schema.String,
  userId: Schema.Union([Schema.Null, Schema.String]),
  workspaceId: Schema.Union([Schema.Null, Schema.String]),
  status: EmailDeliveryStatus,
  providerMessageId: Schema.Union([Schema.Null, Schema.String]),
  lastEventId: Schema.Union([Schema.Null, Schema.String]),
  lastEventAt: Schema.Union([Schema.Null, Schema.String]),
  reason: Schema.Union([Schema.Null, Schema.String]),
  acceptedAt: Schema.Union([Schema.Null, Schema.String]),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  retryUntil: Schema.String,
  nextAttemptAt: Schema.String,
  attemptCount: Schema.Number,
  uncertain: Schema.Boolean
})

export const EmailDeliveryRecords = Schema.Array(LoadSystemEmailDeliverySchema)
