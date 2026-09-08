import {
  truncateResponseBody,
  type WebhookDeliveryAttemptInput
} from './webhook-delivery-plan.ts'

export type QueuedTerminalAttempt = WebhookDeliveryAttemptInput & {
  readonly id: string
  readonly phase: 'terminal'
}

/** Trusted bookkeeping can originate history; queue observations can only settle existing history. */
export type WebhookAttemptObservation =
  | { readonly kind: 'trusted_attempt'; readonly input: WebhookDeliveryAttemptInput }
  | { readonly kind: 'queued_terminal'; readonly input: QueuedTerminalAttempt }

/** Bound evidence again at persistence, including callers other than the HTTP worker. */
export function attemptEvidence(input: WebhookDeliveryAttemptInput) {
  let requestHeaders: Record<string, string> | null = null
  if (input.requestHeaders !== undefined && input.requestHeaders !== null) {
    requestHeaders = Object.fromEntries(
      Object.entries(input.requestHeaders)
        .slice(0, 32)
        .map(([key, value]) => [key.slice(0, 128), value.slice(0, 2048)])
    )
  }
  let responseBody: string | null = null
  if (input.responseBody !== undefined && input.responseBody !== null) {
    responseBody = truncateResponseBody(input.responseBody)
  }
  return {
    phase: input.phase ?? 'http',
    durationMs: input.durationMs ?? null,
    failureReason: input.failureReason?.slice(0, 512) ?? null,
    responseStatus: input.responseStatus ?? null,
    requestHeaders,
    responseBody
  }
}
