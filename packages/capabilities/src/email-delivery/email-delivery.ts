import { emailDeliveryStatuses, emailPurposes } from '@b2b-saas-starter/db/enums'
import { Context, type Effect, Schema } from 'effect'
import { type CapabilityUnavailable } from '../errors.ts'
import { type WorkspaceContext } from '../workspace-context.ts'

export const EmailDeliveryRecord = Schema.Struct({
  id: Schema.String,
  referenceId: Schema.NullOr(Schema.String),
  purpose: Schema.Literals(emailPurposes),
  recipient: Schema.String,
  userId: Schema.NullOr(Schema.String),
  workspaceId: Schema.NullOr(Schema.String),
  status: Schema.Literals(emailDeliveryStatuses),
  providerMessageId: Schema.NullOr(Schema.String),
  lastEventId: Schema.NullOr(Schema.String),
  lastEventAt: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
  acceptedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  retryUntil: Schema.String,
  nextAttemptAt: Schema.String,
  attemptCount: Schema.Number,
  uncertain: Schema.Boolean
})
export type EmailDeliveryRecord = typeof EmailDeliveryRecord.Type
export type ClaimEmail = Pick<
  EmailDeliveryRecord,
  'id' | 'purpose' | 'recipient' | 'userId' | 'workspaceId'
> & { readonly referenceId?: string | null; readonly queuedAt?: string }
export type SendOutcome =
  | { readonly status: 'logged' }
  | { readonly status: 'accepted'; readonly providerMessageId: string | null }
  | {
      readonly status: 'ambiguous' | 'temporary_failure' | 'failed' | 'suppressed'
      readonly reason:
        | 'timeout'
        | 'transport_unavailable'
        | 'provider_rejected'
        | 'provider_suppressed'
    }

export type EmailCompletionDecision =
  | {
      readonly outcome: 'ack'
      readonly status: EmailDeliveryRecord['status'] | 'skipped'
    }
  | {
      readonly outcome: 'retry_pending'
      readonly status: EmailDeliveryRecord['status']
      readonly retryAfterSeconds: number
    }
export const EmailProviderEvent = Schema.Struct({
  eventId: Schema.String,
  messageId: Schema.String,
  recipient: Schema.String,
  status: Schema.Literals(['delivered', 'delayed', 'failed', 'suppressed']),
  occurredAt: Schema.String,
  reason: Schema.optionalKey(
    Schema.Literals([
      'hard_bounce',
      'complaint',
      'provider_suppressed',
      'provider_rejected',
      'temporary_failure'
    ])
  )
})
export type EmailProviderEvent = typeof EmailProviderEvent.Type
type Result<A> = Effect.Effect<A, CapabilityUnavailable>
export type EmailDeliveryInterface = {
  readonly trackedAttempt: <A extends SendOutcome, E, R>(
    input: ClaimEmail,
    attempt: Effect.Effect<A, E, R>,
    classifyFailure: (error: E) => SendOutcome
  ) => Effect.Effect<
    { readonly status: A['status'] | 'skipped' },
    E | CapabilityUnavailable,
    R
  >
  /** Converts persisted attempt evidence into the queue-facing completion. */
  readonly completionDecision: (id: string) => Result<EmailCompletionDecision>
  readonly claim: (input: ClaimEmail) => Result<{ readonly token: string } | null>
  readonly recordOutcome: (
    id: string,
    token: string,
    outcome: SendOutcome
  ) => Result<void>
  /** Settle an unsent delivery with durable operator evidence. */
  readonly abandon: (id: string, reason?: string) => Result<void>
  readonly applyProviderEvent: (
    event: EmailProviderEvent
  ) => Result<'updated' | 'ignored' | 'unmatched'>
  readonly get: (id: string) => Result<EmailDeliveryRecord | null>
  readonly listForUser: (userId: string) => Result<ReadonlyArray<EmailDeliveryRecord>>
  readonly listInvitations: () => Effect.Effect<
    ReadonlyArray<EmailDeliveryRecord>,
    CapabilityUnavailable,
    WorkspaceContext
  >
  readonly latestInvitation: (
    referenceId: string
  ) => Effect.Effect<
    EmailDeliveryRecord | null,
    CapabilityUnavailable,
    WorkspaceContext
  >
  /** Caller must require System Admin. */
  readonly listSystem: () => Result<ReadonlyArray<EmailDeliveryRecord>>
  readonly prune: () => Result<number>
  readonly resolveUserId: (email: string) => Result<string | null>
}
export class EmailDelivery extends Context.Service<
  EmailDelivery,
  EmailDeliveryInterface
>()('@b2b-saas-starter/capabilities/EmailDelivery') {}

/** Missing evidence never authorizes resending an accepted message. */
export function isDeliveryUnconfirmed(
  record: EmailDeliveryRecord,
  now: number
): boolean {
  return (
    ['queued', 'accepted', 'delayed', 'ambiguous'].includes(record.status) &&
    now - Date.parse(record.createdAt) >= 86_400_000
  )
}

export function canResendInvitation(record: EmailDeliveryRecord | null): boolean {
  if (!record) {
    return true
  }
  return (
    record.acceptedAt === null &&
    ['failed', 'temporary_failure', 'ambiguous'].includes(record.status) &&
    !['provider_rejected', 'hard_bounce', 'complaint', 'provider_suppressed'].includes(
      record.reason ?? ''
    )
  )
}
