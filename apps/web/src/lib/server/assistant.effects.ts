import {
  AssistantService,
  isAssistantConfigured,
  selectAssistantLayer,
  type ProviderEnv
} from '@b2b-saas-starter/ai'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect, Schema, type Scope } from 'effect'

import { env as cloudflareEnv } from 'cloudflare:workers'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { workspacePage, type WorkspacePageFrame } from './page-frame'
import {
  type AssistantAnswered,
  type AssistantPagePayload,
  type AskAssistantOutcome,
  type AssistantRefused
} from './assistant'
import { ASSISTANT_UNCONFIGURED_MESSAGE } from '../assistant-copy'

/**
 * The assistant effects and their server-only wiring, reached only through
 * dynamic `import()` inside the handlers of `assistant.ts`: handler bodies
 * are stripped from the client build, so this graph ships to the server
 * alone. `assistant.ts` holds the client-safe half and the reason for the
 * split.
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

/**
 * The server functions' input schemas, decoded here rather than in
 * `assistant.ts`: the client stub never runs validators, and a module-level
 * Schema construct in the client-safe file would drag the Effect Schema
 * chunk onto every page. All input constraints live in the schema — mirrors
 * AssistantPrompt in `packages/ai` so the UI cannot send what the capability
 * would refuse.
 */
const AssistantPageInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})
const decodePageInput = Schema.decodeUnknownSync(AssistantPageInput)

const AskAssistantInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  question: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000))
})

const decodeAskInput = Schema.decodeUnknownSync(AskAssistantInput)

export async function loadAssistantPageHandler(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
  data: unknown
): Promise<AssistantPagePayload> {
  const input = decodePageInput(data)
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
  data: unknown
): Promise<AskAssistantOutcome> {
  const input = decodeAskInput(data)
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
