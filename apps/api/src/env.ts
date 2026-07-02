import type { ProviderEnv, WorkersAIBinding } from '@b2b-saas-starter/ai'
import { makeStarterEnvModuleConfig, type ServerEnv } from '@b2b-saas-starter/env'
import type { StarterEnv, WebhookQueueBinding } from '@b2b-saas-starter/capabilities'
import type { SendEmailBinding } from '@b2b-saas-starter/email'
import type { RateLimitBindings } from './rate-limit.ts'

// The worker's Cloudflare bindings + redacted env. Shared by the handler
// layers, the web-handler assembly, and the fetch entrypoint.
export type ApiEnv = RateLimitBindings &
  Partial<ServerEnv> & {
    readonly DB?: D1Database
    readonly AI?: WorkersAIBinding
    readonly EMAIL?: SendEmailBinding
    readonly WEBHOOK_QUEUE?: WebhookQueueBinding
    readonly CLOUDFLARE_EMAIL_FROM?: string
    /** Back-compat/local alias; deployments forward CLOUDFLARE_EMAIL_FROM. */
    readonly EMAIL_FROM_ADDRESS?: string
  }

export const emailFromAddress = (env: ApiEnv): string | undefined =>
  env.CLOUDFLARE_EMAIL_FROM ?? env.EMAIL_FROM_ADDRESS

export const providerEnv = (env: ApiEnv): ProviderEnv => ({
  ...(env.AI ? { AI: env.AI } : {}),
  ...(env.WORKERS_AI_ENABLED ? { WORKERS_AI_ENABLED: env.WORKERS_AI_ENABLED } : {}),
  ...(env.OPENAI_API_KEY ? { OPENAI_API_KEY: env.OPENAI_API_KEY } : {}),
  ...(env.OPENAI_BASE_URL ? { OPENAI_BASE_URL: env.OPENAI_BASE_URL } : {}),
  ...(env.OPENAI_MODEL_ID ? { OPENAI_MODEL_ID: env.OPENAI_MODEL_ID } : {})
})

// Module-aware env validation (ADR 0035): derive module config status from
// this worker's real env so REST module/integration status reflects the
// deployment instead of stored fixture state.
export const starterEnv = (env: ApiEnv): StarterEnv => ({
  DB: env.DB,
  WEBHOOK_QUEUE: env.WEBHOOK_QUEUE,
  moduleConfig: makeStarterEnvModuleConfig(env)
})
