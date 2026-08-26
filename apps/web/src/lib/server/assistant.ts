import {
  AssistantService,
  isAssistantConfigured,
  selectAssistantLayer,
  type AssistantProvider,
  type ProviderEnv
} from '@b2b-saas-starter/ai'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/src/errors.ts'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/src/workspace-context.ts'
import { type WorkspaceViewer } from '@b2b-saas-starter/capabilities/src/governance/workspace-identity.ts'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema, type Scope } from 'effect'

import { env as cloudflareEnv } from 'cloudflare:workers'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'

/**
 * Honest copy shown wherever the assistant would be, when no provider is
 * configured. It names the variables that enable the feature instead of
 * pretending it is broken (CLAUDE.md rule 3 — provider-light).
 */
export const ASSISTANT_UNCONFIGURED_MESSAGE =
  'The AI assistant is not enabled on this deployment. Set WORKERS_AI_ENABLED=true with the AI binding, or OPENAI_API_KEY, to turn it on.'

/** The provider configuration this worker was deployed with. Only keys that
 * are actually present are copied across — a present-but-undefined key would
 * claim a configuration that does not exist (same rule as `apps/api`). */
function assistantProviderEnv(): ProviderEnv {
  const provider: { -readonly [K in keyof ProviderEnv]: ProviderEnv[K] } = {}
  if (cloudflareEnv.AI) provider.AI = cloudflareEnv.AI
  if (cloudflareEnv.WORKERS_AI_ENABLED) {
    provider.WORKERS_AI_ENABLED = cloudflareEnv.WORKERS_AI_ENABLED
  }
  if (cloudflareEnv.OPENAI_API_KEY) {
    provider.OPENAI_API_KEY = cloudflareEnv.OPENAI_API_KEY
  }
  if (cloudflareEnv.OPENAI_BASE_URL) {
    provider.OPENAI_BASE_URL = cloudflareEnv.OPENAI_BASE_URL
  }
  if (cloudflareEnv.OPENAI_MODEL_ID) {
    provider.OPENAI_MODEL_ID = cloudflareEnv.OPENAI_MODEL_ID
  }
  return provider
}

/**
 * The assistant page payload: who is viewing and whether a real provider is
 * configured. `assistant: ['read']` is the page's own read permission and a
 * hard gate — every role holds it today, so all members get the page; the gate
 * is what keeps the statement table as the single place that decides.
 *
 * `configured` is derived from the same env the ask path uses, so the UI's
 * hidden state can never disagree with the server's answer.
 */
export type AssistantPagePayload = {
  readonly viewer: WorkspaceViewer | null
  readonly configured: boolean
}

const assistantPagePayload: Effect.Effect<
  AssistantPagePayload,
  AuthorizationDenied | CapabilityUnavailable,
  Scope.Scope | WorkspaceContext
> = Effect.gen(function* () {
  yield* requireWorkspacePermission({ assistant: ['read'] })
  const ctx = yield* WorkspaceContext
  return {
    viewer: ctx.actor ? { role: ctx.actor.role } : null,
    configured: isAssistantConfigured(assistantProviderEnv())
  }
})

/** The assistant route's loader. */
export function loadAssistantPage(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<AssistantPagePayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, assistantPagePayload, {
    userId: input.userId
  })
}

/**
 * What an ask turns into. Failures are values here rather than rejections:
 * "the provider is off" and "the provider errored" are states the chat UI
 * renders inline, not errors worth breaking the transcript over.
 */
/** The success side of {@link AskAssistantOutcome}, named for annotations. */
export type AssistantAnswered = Extract<AskAssistantOutcome, { readonly ok: true }>
/** The failure side of {@link AskAssistantOutcome}, named for annotations. */
export type AssistantRefused = Extract<AskAssistantOutcome, { readonly ok: false }>

export type AskAssistantOutcome =
  | {
      readonly ok: true
      readonly answer: string
      readonly provider: AssistantProvider
      readonly modelId: string
    }
  | {
      readonly ok: false
      readonly reason: 'unconfigured' | 'unavailable'
      readonly message: string
    }

// All input constraints live in the schema — mirrors AssistantPrompt in
// `packages/ai` so the UI cannot send what the capability would refuse.
export const AskAssistantInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  question: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000))
})

const decodeAskInput = Schema.decodeUnknownSync(AskAssistantInput)

/**
 * The effect below the session gate: proves the actor may use the assistant
 * (`assistant: ['read']`), then asks through `AssistantService`. Exported so
 * tests drive it against fixture layers without a request or auth runtime.
 *
 * The service is a requirement, not an import — the caller provides the layer
 * selected from the deployment's env, which keeps this effect honest under test.
 */
export function askAssistantEffect(
  question: string,
  provider: ProviderEnv
): Effect.Effect<
  AskAssistantOutcome,
  AuthorizationDenied | CapabilityUnavailable,
  Scope.Scope | WorkspaceContext | AssistantService
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ assistant: ['read'] })
    const ctx = yield* WorkspaceContext
    if (!isAssistantConfigured(provider)) {
      return {
        ok: false,
        reason: 'unconfigured',
        message: ASSISTANT_UNCONFIGURED_MESSAGE
      }
    }
    const service = yield* AssistantService
    // Annotated so the outcome object literals keep their discriminated
    // `ok` values instead of widening to `boolean`.
    const answered: Effect.Effect<AskAssistantOutcome, never, never> = service
      .ask({ workspaceSlug: ctx.workspace.slug, question })
      .pipe(
        Effect.map((reply): AssistantAnswered => ({
          ok: true,
          answer: reply.answer,
          provider: reply.provider,
          modelId: reply.modelId
        })),
        Effect.catchTag('AssistantUnavailable', (error) =>
          Effect.succeed<AssistantRefused>({
            ok: false,
            reason: 'unavailable',
            message: `The assistant could not answer right now (${error.reason}).`
          })
        )
      )
    return yield* answered
  })
}

export const askAssistantServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeAskInput(input))
  .handler(async ({ data }): Promise<AskAssistantOutcome> => {
    const session = await requireRequestSession()
    const provider = assistantProviderEnv()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      askAssistantEffect(data.question, provider).pipe(
        // Per call, from the same env snapshot the permission check ran
        // against — mock when unconfigured, Workers AI / OpenAI-compatible
        // when the deployment says so.
        Effect.provide(selectAssistantLayer(provider))
      ),
      { userId: session.user.id }
    )
  })
