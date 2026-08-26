import { starterEnv } from '@b2b-saas-starter/capabilities/src/runtime.ts'
import { type WebhookQueueBinding } from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-publisher.ts'
import { type ServerEnv } from '@b2b-saas-starter/env/src/server.ts'
import { type ProviderEnv, type WorkersAIBinding } from '@b2b-saas-starter/ai'

import { type RateLimitBindings } from './rate-limit.ts'

// The worker's Cloudflare bindings + redacted env. Shared by the handler
// layers, the web-handler assembly, and the fetch entrypoint.
export type ApiEnv = RateLimitBindings &
  Partial<ServerEnv> & {
    readonly DB?: D1Database
    readonly AI?: WorkersAIBinding
    readonly WEBHOOK_QUEUE?: WebhookQueueBinding
  }

// Only configured provider vars are copied across: an absent key leaves the
// assistant on its mock provider, while a present-but-undefined key
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

// Capability env: the D1 binding selects Live vs Seed, and the webhook queue
// binding enables real fan-out. The projection lives beside `StarterEnv` in
// the capabilities package; this re-export keeps the local import path stable.
export { starterEnv }
