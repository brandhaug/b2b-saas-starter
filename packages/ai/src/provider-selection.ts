import { hasValue, type ProviderEnvOf } from '@b2b-saas-starter/env/server'
import { type Layer } from 'effect'
import { type LanguageModel, type Model } from 'effect/unstable/ai'
import { MockAssistantModel } from './mock.ts'
import { type OpenAIConfig, makeOpenAIModel } from './openai.ts'
import { type WorkersAIBinding, makeWorkersAIModel } from './workers-ai.ts'

export type ProviderEnv = ProviderEnvOf<
  'WORKERS_AI_ENABLED' | 'OPENAI_API_KEY' | 'OPENAI_BASE_URL' | 'OPENAI_MODEL_ID'
> & {
  readonly AI?: WorkersAIBinding | undefined
}

/**
 * The one place that decides which provider a deployment configured.
 * `selectModel` builds the `Model` layer for the choice (a `LanguageModel`
 * plus its `ProviderName` / `ModelName` stamps), `selectAssistantLayer`
 * composes it under `AssistantLive`, and `isAssistantConfigured` asks whether
 * the choice is a real provider — so the condition ("Workers AI with its
 * binding, or an OpenAI key") is stated once and the UI's "not enabled" copy
 * can never disagree with the ask path.
 */
type ProviderChoice =
  | { readonly provider: 'workers-ai'; readonly binding: WorkersAIBinding }
  | { readonly provider: 'openai-compatible'; readonly config: OpenAIConfig }
  | { readonly provider: 'mock' }

export function selectProvider(env: ProviderEnv): ProviderChoice {
  if (env.WORKERS_AI_ENABLED === 'true' && env.AI) {
    return { provider: 'workers-ai', binding: env.AI }
  }
  if (hasValue(env.OPENAI_API_KEY)) {
    // Set only when present so the layer's own defaults (api.openai.com,
    // gpt-4o-mini) still apply for absent vars.
    const config: OpenAIConfig = {
      apiKey: env.OPENAI_API_KEY,
      ...(hasValue(env.OPENAI_BASE_URL) && { baseUrl: env.OPENAI_BASE_URL }),
      ...(hasValue(env.OPENAI_MODEL_ID) && { modelId: env.OPENAI_MODEL_ID })
    }
    return { provider: 'openai-compatible', config }
  }
  return { provider: 'mock' }
}

export function selectModel(
  env: ProviderEnv
): Layer.Layer<LanguageModel.LanguageModel | Model.ProviderName | Model.ModelName> {
  const choice = selectProvider(env)
  switch (choice.provider) {
    case 'workers-ai': {
      return makeWorkersAIModel(choice.binding)
    }
    case 'openai-compatible': {
      return makeOpenAIModel(choice.config)
    }
    case 'mock': {
      return MockAssistantModel
    }
  }
}

/** Whether a real provider is configured. */
export function isAssistantConfigured(env: ProviderEnv): boolean {
  return selectProvider(env).provider !== 'mock'
}
