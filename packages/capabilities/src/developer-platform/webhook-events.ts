/**
 * The webhook event vocabulary, in a dependency-free leaf so client surfaces
 * (the management UI's checkbox set) can read it without pulling the
 * capability's `effect`/`Schema` graph into a browser bundle. The service
 * module (`webhook-endpoints.ts`) re-exports it — the values are still
 * written once.
 */

/**
 * The event types this starter currently publishes (the mutating capabilities
 * fan out below their interface — `ApiTokenRegistry` and `WebhookEndpoints.create`).
 * Subscriptions are free-text strings so a producer can grow without a
 * migration; this list is what the management UI offers as checkboxes.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const WEBHOOK_EVENT_TYPES = [
  'api_token.created',
  'api_token.revoked',
  'webhook_endpoint.created'
] as const

/** The union of {@link WEBHOOK_EVENT_TYPES} — the vocabulary is written once. */
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]
