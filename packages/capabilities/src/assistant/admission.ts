import { Context, type Effect, Schema } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'

export const AssistantReservation = Schema.Struct({
  id: Schema.String,
  conversationId: Schema.String,
  workspaceId: Schema.String,
  userId: Schema.String,
  createdAt: Schema.Number,
  deadline: Schema.Number,
  committedAt: Schema.NullOr(Schema.Number),
  releasedAt: Schema.NullOr(Schema.Number)
})
export type AssistantReservation = typeof AssistantReservation.Type
export type ReserveAssistantInput = Pick<
  AssistantReservation,
  'id' | 'conversationId' | 'workspaceId' | 'userId' | 'deadline'
> & {
  readonly activeLimit: number
  readonly rateLimit: number
}
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory
export class AssistantAdmissionRefused extends Schema.TaggedError<AssistantAdmissionRefused>()(
  'AssistantAdmissionRefused',
  {
    reason: Schema.Literals(['concurrency_limit', 'generation_rate_limit']),
    retryAfterSeconds: Schema.Number
  },
  { httpApiStatus: 429 }
) {}

export type AssistantAdmissionInterface = {
  readonly reserve: (
    input: ReserveAssistantInput
  ) => Effect.Effect<
    AssistantReservation,
    CapabilityUnavailable | AssistantAdmissionRefused
  >
  readonly commit: (id: string) => Effect.Effect<void, CapabilityUnavailable>
  readonly reconcileExpired: (
    limit?: number
  ) => Effect.Effect<number, CapabilityUnavailable>
  readonly release: (id: string) => Effect.Effect<void, CapabilityUnavailable>
}
export class AssistantAdmission extends Context.Service<
  AssistantAdmission,
  AssistantAdmissionInterface
>()('@b2b-saas-starter/capabilities/AssistantAdmission') {}

export const ASSISTANT_SHUTDOWN_GRACE_MS = 30_000
