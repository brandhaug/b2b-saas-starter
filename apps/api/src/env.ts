import { type ProviderEnv, type WorkersAIBinding } from '@b2b-saas-starter/ai'
import { makeStarterEnvModuleConfig, type ServerEnv } from '@b2b-saas-starter/env'
import {
  type StarterEnv,
  type WebhookQueueBinding
} from '@b2b-saas-starter/capabilities'
import { type RateLimitBindings } from './rate-limit.ts'

// The worker's Cloudflare bindings + redacted env. Shared by the handler
// layers, the web-handler assembly, and the fetch entrypoint.
export type ApiEnv = RateLimitBindings &
  Partial<ServerEnv> & {
    readonly DB?: D1Database
    readonly AI?: WorkersAIBinding
    readonly WEBHOOK_QUEUE?: WebhookQueueBinding
    /**
     * Read only by module-config readiness (ADR 0035), which reports the
     * `cloudflare-email` module from it. This worker sends no email of its own
     * — see the intent node.
     */
    readonly CLOUDFLARE_EMAIL_FROM?: string
  }

// Only configured provider vars are copied across: an absent key leaves the
// assistant in its mock/needs-config state, while a present-but-undefined key
// would claim configuration that does not exist.
export function providerEnv(env: ApiEnv): ProviderEnv {
  const provider: { -readonly [K in keyof ProviderEnv]: ProviderEnv[K] } = {}
  if (env.AI) provider.AI = env.AI
  if (env.WORKERS_AI_ENABLED) provider.WORKERS_AI_ENABLED = env.WORKERS_AI_ENABLED
  if (env.OPENAI_API_KEY) provider.OPENAI_API_KEY = env.OPENAI_API_KEY
  if (env.OPENAI_BASE_URL) provider.OPENAI_BASE_URL = env.OPENAI_BASE_URL
  if (env.OPENAI_MODEL_ID) provider.OPENAI_MODEL_ID = env.OPENAI_MODEL_ID
  return provider
}

// Module-aware env validation (ADR 0035): derive module config status from
// this worker's real env so REST module/integration status reflects the
// deployment instead of stored fixture state.
export function starterEnv(env: ApiEnv): StarterEnv {
  return {
    DB: env.DB,
    WEBHOOK_QUEUE: env.WEBHOOK_QUEUE,
    moduleConfig: makeStarterEnvModuleConfig(env)
  }
}
