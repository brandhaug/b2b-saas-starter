import { Effect, Result, type Scope } from 'effect'
import {
  AssistantPrompt,
  AssistantService,
  isAssistantConfigured,
  type ProviderEnv
} from '@b2b-saas-starter/ai'
import {
  CatalogRefreshHistory,
  StarterModuleCatalog,
  type CapabilityUnavailable
} from '@b2b-saas-starter/capabilities'
import { annotateWide } from '@b2b-saas-starter/logger'
import { decodeBodyOr400, json, type InvalidInput } from '../http.ts'

export const catalogModulesHandler: Effect.Effect<
  Response,
  CapabilityUnavailable,
  StarterModuleCatalog
> = Effect.gen(function* () {
  const catalog = yield* StarterModuleCatalog
  const modules = yield* catalog.listAllModules
  return json(modules)
})

export const catalogRefreshHistoryHandler: Effect.Effect<
  Response,
  CapabilityUnavailable,
  CatalogRefreshHistory
> = Effect.gen(function* () {
  const history = yield* CatalogRefreshHistory
  const recent = yield* history.listRecent
  return json(recent)
})

export const mcpDiscoverResponse = (): Response =>
  json({
    name: 'b2b-saas-starter-mcp',
    resources: ['workspace://starter-lab/overview'],
    tools: []
  })

export const answerAssistantEffect = (
  request: Request,
  env: ProviderEnv
): Effect.Effect<Response, InvalidInput, AssistantService | Scope.Scope> =>
  Effect.gen(function* () {
    const prompt = yield* decodeBodyOr400(request, AssistantPrompt, 'invalid_prompt')
    const service = yield* AssistantService
    const reply = yield* Effect.result(service.ask(prompt))
    if (Result.isFailure(reply)) {
      yield* annotateWide({
        outcome: 'assistant_unavailable',
        assistantError: reply.failure.reason
      })
      return json({ error: 'assistant_unavailable' }, { status: 503 })
    }
    yield* annotateWide({ outcome: 'ok' })
    return json({
      ...reply.success,
      assistantConfigured: isAssistantConfigured(env)
    })
  })
