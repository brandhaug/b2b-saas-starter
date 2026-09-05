import {
  AssistantService,
  isAssistantConfigured,
  selectAssistantLayer,
  type ProviderEnv
} from '@b2b-saas-starter/ai'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect, type Scope } from 'effect'

import { env as cloudflareEnv } from 'cloudflare:workers'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { workspacePage, type WorkspacePageFrame } from './page-frame'
import {
  type AssistantAnswered,
  type AssistantPageInput,
  type AssistantPagePayload,
  type AskAssistantInput,
  type AskAssistantOutcome,
  type AssistantRefused
} from './assistant'
import { ASSISTANT_UNCONFIGURED_MESSAGE } from '../assistant-copy'

/**
 * The assistant effects and their server-only wiring, reached only through
 * dynamic `import()` inside the handlers of `assistant.ts` (see
 * apps/web/AGENTS.md). `assistant.ts` holds the client-safe half and the
 * reason for the split.
 */

const assistantPagePayload: WorkspacePageFrame<AssistantPagePayload> = workspacePage(
  { assistant: ['read'] },
  () => Effect.sync(() => ({ configured: isAssistantConfigured(cloudflareEnv) }))
)

/** The assistant route's loader, as a plain function for tests. */
export function loadAssistantPage(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<AssistantPagePayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, assistantPagePayload, {
    userId: input.userId
  })
}

export async function loadAssistantPageHandler(
  input: AssistantPageInput
): Promise<AssistantPagePayload> {
  const session = await requireRequestSession()
  return loadAssistantPage({
    workspaceSlug: input.workspaceSlug,
    userId: session.user.id
  })
}

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

export async function askAssistantHandler(
  input: AskAssistantInput
): Promise<AskAssistantOutcome> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    askAssistantEffect(input.question, cloudflareEnv).pipe(
      // Per call, from the same worker env the configured-check reads —
      // mock when unconfigured, Workers AI / OpenAI-compatible when the
      // deployment says so.
      Effect.provide(selectAssistantLayer(cloudflareEnv))
    ),
    { userId: session.user.id }
  )
}
