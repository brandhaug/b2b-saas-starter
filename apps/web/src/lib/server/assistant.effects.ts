import { m } from '@b2b-saas-starter/i18n/messages'
import {
  AssistantService,
  isAssistantConfigured,
  selectAssistantLayer
} from '@b2b-saas-starter/ai'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect } from 'effect'

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

export async function loadAssistantPageHandler(
  input: AssistantPageInput
): Promise<AssistantPagePayload> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(input.workspaceSlug, assistantPagePayload, {
    userId: session.user.id
  })
}

export async function askAssistantHandler(
  input: AskAssistantInput
): Promise<AskAssistantOutcome> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      // The session gate above proves who is asking; this proves they may.
      // The service is a requirement, not an import — the layer selected
      // from the deployment's env rides the call below, so the answer stays
      // honest per deployment.
      yield* requireWorkspacePermission({ assistant: ['read'] })
      const ctx = yield* WorkspaceContext
      if (!isAssistantConfigured(cloudflareEnv)) {
        return {
          ok: false,
          reason: 'unconfigured',
          message: m.server_assistant_unconfigured()
        } satisfies AssistantRefused
      }
      const service = yield* AssistantService
      // Annotated so the outcome object literals keep their discriminated
      // `ok` values instead of widening to `boolean`.
      const answered: Effect.Effect<AskAssistantOutcome, never, never> = service
        .ask({ workspaceSlug: ctx.workspace.slug, question: input.question })
        .pipe(
          Effect.map((reply): AssistantAnswered => ({
            ok: true,
            answer: reply.answer,
            provider: reply.provider,
            modelId: reply.modelId
          })),
          Effect.catchTag('AssistantUnavailable', () =>
            Effect.succeed<AssistantRefused>({
              ok: false,
              reason: 'unavailable',
              message: m.server_assistant_unavailable()
            })
          )
        )
      return yield* answered
    }).pipe(
      // Per call, from the same worker env the configured-check reads —
      // mock when unconfigured, Workers AI / OpenAI-compatible when the
      // deployment says so.
      Effect.provide(selectAssistantLayer(cloudflareEnv))
    ),
    { userId: session.user.id }
  )
}
