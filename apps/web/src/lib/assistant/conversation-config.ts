import { type ServerEnv } from '@b2b-saas-starter/env/server'
import { Effect, Schema } from 'effect'
import { ConversationUnavailable } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'

const Positive = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(2_000_000)
)
const Limits = Schema.Struct({
  deadlineMs: Positive,
  activeLimit: Positive,
  rateLimit: Positive,
  maxInputTokens: Positive,
  maxOutputTokens: Positive,
  providerContextTokens: Schema.optionalKey(Positive),
  providerOutputTokens: Schema.optionalKey(Positive)
})
export type ConversationLimits = typeof Limits.Type

const decodeLimits = Schema.decodeUnknownEffect(Limits)

export function conversationLimits(env: Partial<ServerEnv>) {
  const limits: ConversationLimits = {
    deadlineMs: Number(env.ASSISTANT_DEADLINE_MS ?? 600_000),
    activeLimit: Number(env.ASSISTANT_ACTIVE_LIMIT ?? 3),
    rateLimit: Number(env.ASSISTANT_RATE_LIMIT ?? 20),
    maxInputTokens: Number(env.ASSISTANT_INPUT_TOKENS ?? 64_000),
    maxOutputTokens: Number(env.ASSISTANT_OUTPUT_TOKENS ?? 16_000)
  }
  if (env.ASSISTANT_PROVIDER_CONTEXT_TOKENS !== undefined) {
    Object.assign(limits, {
      providerContextTokens: Number(env.ASSISTANT_PROVIDER_CONTEXT_TOKENS)
    })
  }
  if (env.ASSISTANT_PROVIDER_OUTPUT_TOKENS !== undefined) {
    Object.assign(limits, {
      providerOutputTokens: Number(env.ASSISTANT_PROVIDER_OUTPUT_TOKENS)
    })
  }
  return decodeLimits(limits).pipe(
    Effect.mapError(() => new ConversationUnavailable({ reason: 'configuration' }))
  )
}
