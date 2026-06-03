import type { WorkersAIBinding } from '@b2b-saas-starter/ai'
import type { SendEmailBinding } from '@b2b-saas-starter/email'
import type { RateLimitBindings } from './rate-limit.ts'

// The worker's Cloudflare bindings + redacted env. Shared by the handler
// layers, the web-handler assembly, and the fetch entrypoint.
export type ApiEnv = RateLimitBindings & {
  readonly DB?: D1Database
  readonly AI?: WorkersAIBinding
  readonly EMAIL?: SendEmailBinding
  readonly EMAIL_FROM_ADDRESS?: string
  readonly WORKERS_AI_ENABLED?: string
  readonly OPENAI_API_KEY?: string
  readonly OPENAI_BASE_URL?: string
  readonly OPENAI_MODEL_ID?: string
}
