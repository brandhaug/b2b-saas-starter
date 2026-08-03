import { Effect } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'

export type TransactionalEmailRuntime = 'local' | 'test' | 'preview' | 'production'
export type TransactionalEmailLocale = 'ro' | 'en'
export type TransactionalEmailProviderState =
  | 'capture'
  | 'configured'
  | 'needs_configuration'
  | 'disabled'

export type EmailProviderSubmission =
  | { readonly _tag: 'captured'; readonly capturedAt: string }
  | {
      readonly _tag: 'accepted'
      readonly providerReferenceFingerprint: string
      readonly acceptedAt: string
    }
  | { readonly _tag: 'failed'; readonly code: string; readonly retryable: boolean }
  | { readonly _tag: 'submission_unknown'; readonly code: string }

export type EmailProviderCallback =
  | {
      readonly _tag: 'verified'
      readonly providerReferenceFingerprint: string
      readonly eventFingerprint: string
      readonly status: 'delivered' | 'failed'
      readonly occurredAt: string
      readonly code?: string
    }
  | { readonly _tag: 'ignored' }
  | { readonly _tag: 'rejected'; readonly code: string }

export type TransactionalEmailProvider = {
  readonly state: TransactionalEmailProviderState
  readonly sender?: string
  readonly fingerprintDestination: (
    destination: string
  ) => Effect.Effect<string, CapabilityUnavailable>
  readonly submit: (input: {
    readonly idempotencyKey: string
    readonly from: string
    readonly to: string
    readonly subject: string
    readonly text: string
    readonly locale: TransactionalEmailLocale
    readonly templateKey: string
  }) => Effect.Effect<EmailProviderSubmission, CapabilityUnavailable>
  readonly verifyCallback: (input: {
    readonly rawBody: string
    readonly signature: string
    readonly timestamp: string
    readonly now?: string
  }) => Effect.Effect<EmailProviderCallback, CapabilityUnavailable>
  readonly signCallbackForTest?: (timestamp: string, rawBody: string) => Promise<string>
}

const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )

const hmac = async (secret: string, value: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
}

const fingerprint = async (secret: string, value: string) =>
  `hmac-sha256:${await hmac(secret, value)}`

const normalizeFailureCode = (value: unknown) =>
  value === 'hard_bounce' || value === 'complaint' || value === 'rejected'
    ? value
    : 'provider_failed'

const sameSignature = (left: string, right: string) => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

export const makeConfiguredTransactionalEmailProvider = (input: {
  readonly sender: string
  readonly callbackSecret: string
  readonly providerReferenceFingerprintKey: string
  readonly timeoutMs?: number
  readonly send?: (message: {
    readonly idempotencyKey: string
    readonly from: string
    readonly to: string
    readonly subject: string
    readonly text: string
  }) => Promise<{ readonly providerSubmissionId: string; readonly acceptedAt: string }>
}): TransactionalEmailProvider => {
  const sign = (timestamp: string, rawBody: string) =>
    hmac(input.callbackSecret, `${timestamp}.${rawBody}`)
  return {
    state: 'configured',
    sender: input.sender,
    fingerprintDestination: (destination) =>
      Effect.promise(() =>
        fingerprint(input.providerReferenceFingerprintKey, `destination:${destination}`)
      ),
    submit: input.send
      ? (message) =>
          Effect.tryPromise({
            try: () => input.send!(message),
            catch: () =>
              new CapabilityUnavailable({
                capability: 'transactional-email-provider',
                reason: 'provider_request_failed'
              })
          }).pipe(
            Effect.flatMap((accepted) =>
              Effect.map(
                Effect.promise(() =>
                  fingerprint(
                    input.providerReferenceFingerprintKey,
                    accepted.providerSubmissionId
                  )
                ),
                (providerReferenceFingerprint): EmailProviderSubmission => ({
                  _tag: 'accepted',
                  providerReferenceFingerprint,
                  acceptedAt: accepted.acceptedAt
                })
              )
            ),
            Effect.catch(() =>
              Effect.succeed<EmailProviderSubmission>({
                _tag: 'submission_unknown',
                code: 'provider_request_failed'
              })
            ),
            Effect.timeoutOrElse({
              duration: `${input.timeoutMs ?? 10_000} millis`,
              orElse: () =>
                Effect.succeed<EmailProviderSubmission>({
                  _tag: 'submission_unknown',
                  code: 'provider_timeout'
                })
            })
          )
      : () =>
          Effect.fail(
            new CapabilityUnavailable({
              capability: 'transactional-email-provider',
              reason: 'provider_submission_not_configured'
            })
          ),
    verifyCallback: ({ rawBody, signature, timestamp, now }) =>
      Effect.tryPromise({
        try: async (): Promise<EmailProviderCallback> => {
          if (
            !Number.isFinite(Date.parse(timestamp)) ||
            (now && Math.abs(Date.parse(now) - Date.parse(timestamp)) > 5 * 60_000)
          )
            return { _tag: 'rejected', code: 'stale_timestamp' }
          if (!sameSignature(await sign(timestamp, rawBody), signature))
            return { _tag: 'rejected', code: 'invalid_signature' }
          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(rawBody) as Record<string, unknown>
          } catch {
            return { _tag: 'rejected', code: 'invalid_payload' }
          }
          if (
            typeof parsed.eventId !== 'string' ||
            parsed.eventId.length === 0 ||
            typeof parsed.messageId !== 'string' ||
            parsed.messageId.length === 0 ||
            (parsed.status !== 'delivered' && parsed.status !== 'failed') ||
            typeof parsed.occurredAt !== 'string' ||
            !Number.isFinite(Date.parse(parsed.occurredAt))
          )
            return { _tag: 'rejected', code: 'invalid_payload' }
          return {
            _tag: 'verified',
            eventFingerprint: await fingerprint(
              input.providerReferenceFingerprintKey,
              parsed.eventId
            ),
            providerReferenceFingerprint: await fingerprint(
              input.providerReferenceFingerprintKey,
              parsed.messageId
            ),
            status: parsed.status,
            occurredAt: new Date(Date.parse(parsed.occurredAt)).toISOString(),
            ...(parsed.status === 'failed'
              ? { code: normalizeFailureCode(parsed.code) }
              : {})
          }
        },
        catch: () =>
          new CapabilityUnavailable({
            capability: 'transactional-email-callback',
            reason: 'callback_verification_failed'
          })
      }),
    signCallbackForTest: sign
  }
}

const captureProvider = (): TransactionalEmailProvider => ({
  state: 'capture',
  sender: 'capture@beesolo.local',
  fingerprintDestination: (destination) =>
    Effect.promise(() =>
      fingerprint('beesolo-local-capture-destination-key', `destination:${destination}`)
    ),
  submit: () =>
    Effect.succeed({ _tag: 'captured', capturedAt: new Date().toISOString() }),
  verifyCallback: () => Effect.succeed({ _tag: 'ignored' })
})

const unavailableProvider = (
  state: 'needs_configuration' | 'disabled'
): TransactionalEmailProvider => ({
  state,
  fingerprintDestination: () =>
    Effect.fail(
      new CapabilityUnavailable({
        capability: 'transactional-email-provider',
        reason: state
      })
    ),
  submit: () =>
    Effect.fail(
      new CapabilityUnavailable({
        capability: 'transactional-email-provider',
        reason: state
      })
    ),
  verifyCallback: () => Effect.succeed({ _tag: 'rejected', code: state })
})

export const selectTransactionalEmailProvider = (input: {
  readonly runtime: TransactionalEmailRuntime
  readonly provider?: TransactionalEmailProvider
  readonly disabled?: boolean
}) =>
  input.disabled
    ? unavailableProvider('disabled')
    : input.provider
      ? input.provider
      : input.runtime === 'local' || input.runtime === 'test'
        ? captureProvider()
        : unavailableProvider('needs_configuration')
