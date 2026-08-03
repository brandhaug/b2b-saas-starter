import type { D1Database } from '@cloudflare/workers-types'
import { Effect, Redacted, Schema } from 'effect'
import {
  ProviderSubmissionOutcome,
  type ProviderSubmissionShape
} from './provider-contracts.ts'

type MetaRequest = Extract<
  Parameters<ProviderSubmissionShape['submit']>[0],
  { readonly provider: 'meta' }
>
type MetaOutcome = typeof ProviderSubmissionOutcome.Type

type ErrorClassification = 'retryable' | 'terminal'

const ERROR_POLICIES = [
  {
    version: 'meta-errors-2026-07-29',
    effectiveAt: '2026-07-29T00:00:00.000Z',
    retryable: new Set([4, 17, 80007, 130429, 131048, 131056]),
    terminal: new Set([100, 190, 368, 131008, 131009, 131021, 131026, 132000, 132001])
  }
] as const

const PRICING_POLICIES = [
  {
    version: 'meta-pricing-2026-07-29',
    effectiveAt: '2026-07-29T00:00:00.000Z'
  }
] as const

const effective = <A extends { readonly effectiveAt: string }>(
  values: readonly A[],
  at: string
): A | undefined =>
  values
    .filter((value) => value.effectiveAt <= at)
    .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0]

export const classifyMetaError = (
  code: number,
  at: string
): {
  readonly policyVersion: string
  readonly classification: ErrorClassification
} | null => {
  const policy = effective(ERROR_POLICIES, at)
  if (!policy) return null
  if (policy.retryable.has(code))
    return { policyVersion: policy.version, classification: 'retryable' }
  if (policy.terminal.has(code))
    return { policyVersion: policy.version, classification: 'terminal' }
  return null
}

export const metaErrorPolicyVersion = (at: string): string | null =>
  effective(ERROR_POLICIES, at)?.version ?? null

export const classifyMetaPricing = (
  pricing: unknown,
  at: string
): {
  readonly policyVersion: string
  readonly billable: boolean
  readonly category: 'utility' | 'authentication' | 'marketing' | 'service' | 'unknown'
  readonly pricingModel: string
} | null => {
  const policy = effective(PRICING_POLICIES, at)
  if (!policy || !pricing || typeof pricing !== 'object') return null
  const value = pricing as Record<string, unknown>
  if (typeof value.billable !== 'boolean' || typeof value.pricing_model !== 'string')
    return null
  const category =
    value.category === 'utility' ||
    value.category === 'authentication' ||
    value.category === 'marketing' ||
    value.category === 'service'
      ? value.category
      : 'unknown'
  return {
    policyVersion: policy.version,
    billable: value.billable,
    category,
    pricingModel: value.pricing_model
  }
}

const parseRetryAfter = (response: Response): number => {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 30
}

const responseJson = async (response: Response): Promise<unknown> => {
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > 64 * 1024)
    throw new Error('Meta response exceeded 64 KiB')
  return JSON.parse(text) as unknown
}

const MetaErrorEnvelope = Schema.Struct({
  error: Schema.Struct({ code: Schema.Int })
})
const MetaSuccessEnvelope = Schema.Struct({
  messages: Schema.Array(Schema.Struct({ id: Schema.String }))
})

const metaCode = (value: unknown): number | null => {
  try {
    return Schema.decodeUnknownSync(MetaErrorEnvelope)(value).error.code
  } catch {
    return null
  }
}

const wamid = (value: unknown): string | null => {
  try {
    const messages = Schema.decodeUnknownSync(MetaSuccessEnvelope)(value).messages
    if (messages.length !== 1) return null
    const providerReference = messages[0]!.id
    return providerReference.startsWith('wamid.') && providerReference.length <= 512
      ? providerReference
      : null
  } catch {
    return null
  }
}

export const makeMetaWhatsAppSubmission = (options: {
  readonly accessToken: Redacted.Redacted<string>
  readonly phoneNumberId: string
  readonly graphApiVersion: string
  readonly providerAccountKey: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMilliseconds?: number
  readonly now?: () => string
  readonly protectReference: (input: {
    readonly attemptId: string
    readonly providerAccountKey: string
    readonly providerReference: string
  }) => Promise<string>
}): ((request: MetaRequest) => ReturnType<ProviderSubmissionShape['submit']>) => {
  const fetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date().toISOString())
  return (request) =>
    Effect.promise(async (): Promise<MetaOutcome> => {
      const observedAt = now()
      const controller = new AbortController()
      const timer = setTimeout(
        () => controller.abort(),
        options.timeoutMilliseconds ?? 10_000
      )
      try {
        const body = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: Redacted.value(request.destination),
          type: 'template',
          template: {
            name: request.templateKey,
            language: { code: request.locale === 'ro' ? 'ro' : 'en_US' },
            components: [
              {
                type: 'body',
                parameters: request.templateParameters.map((parameter) => ({
                  type: 'text',
                  text: Redacted.value(parameter)
                }))
              }
            ]
          }
        }
        const response = await fetch(
          `https://graph.facebook.com/${options.graphApiVersion}/${options.phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${Redacted.value(options.accessToken)}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal: controller.signal
          }
        )
        if (response.status === 429)
          return { _tag: 'throttled', retryAfterSeconds: parseRetryAfter(response) }
        const decoded = await responseJson(response).catch(() => null)
        if (!response.ok) {
          const code = metaCode(decoded)
          const classification =
            code === null ? null : classifyMetaError(code, observedAt)
          return classification
            ? {
                _tag: 'rejected',
                classification: classification.classification,
                code: 'provider_rejected',
                ...(code === null ? {} : { providerCode: code }),
                classificationPolicyVersion: classification.policyVersion
              }
            : { _tag: 'ambiguous', observedAt }
        }
        const reference = wamid(decoded)
        if (!reference) return { _tag: 'ambiguous', observedAt }
        const providerReferenceFingerprint = await options.protectReference({
          attemptId: request.attemptId,
          providerAccountKey: options.providerAccountKey,
          providerReference: reference
        })
        return {
          _tag: 'accepted',
          providerReferenceFingerprint,
          acceptedAt: observedAt
        }
      } catch {
        return { _tag: 'ambiguous', observedAt }
      } finally {
        clearTimeout(timer)
      }
    })
}

const bytesToHex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const toBase64 = (value: Uint8Array) => {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const deriveKey = (secret: string, purpose: string) =>
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${purpose}:${secret}`))

export const fingerprintMetaReference = async (
  providerReference: string,
  fingerprintSecret: string
): Promise<string> => {
  const fingerprintKey = await crypto.subtle.importKey(
    'raw',
    await deriveKey(fingerprintSecret, 'meta-provider-reference-fingerprint'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return `sha256:${bytesToHex(
    await crypto.subtle.sign(
      'HMAC',
      fingerprintKey,
      new TextEncoder().encode(providerReference)
    )
  )}`
}

export const makeD1MetaReferenceProtector =
  (options: {
    readonly db: D1Database
    readonly encryptionSecret: string
    readonly fingerprintSecret: string
    readonly keyVersion: number
    readonly environment: string
  }) =>
  async (input: {
    readonly attemptId: string
    readonly providerAccountKey: string
    readonly providerReference: string
  }): Promise<string> => {
    const encoded = new TextEncoder().encode(input.providerReference)
    const fingerprint = await fingerprintMetaReference(
      input.providerReference,
      options.fingerprintSecret
    )
    const encryptionKey = await crypto.subtle.importKey(
      'raw',
      await deriveKey(options.encryptionSecret, 'meta-provider-reference-encryption'),
      'AES-GCM',
      false,
      ['encrypt']
    )
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, encoded)
    )
    const envelope = new Uint8Array(iv.length + encrypted.length)
    envelope.set(iv)
    envelope.set(encrypted, iv.length)
    const now = new Date().toISOString()
    const result = await options.db
      .prepare(
        `INSERT INTO protected_provider_references
         (id, shop_id, attempt_id, environment, provider, provider_account_key,
          reference_type, ciphertext, key_version, fingerprint, masked_suffix, created_at)
         SELECT ?, sa.shop_id, sa.id, ?, 'meta', ?, 'message_id', ?, ?, ?, ?, ?
         FROM submission_attempts sa WHERE sa.id = ?
         ON CONFLICT(environment, provider, provider_account_key, reference_type, fingerprint)
         DO NOTHING`
      )
      .bind(
        `ppr_${crypto.randomUUID()}`,
        options.environment,
        input.providerAccountKey,
        toBase64(envelope),
        options.keyVersion,
        fingerprint,
        input.providerReference.slice(-8),
        now,
        input.attemptId
      )
      .run()
    if (!result.success) throw new Error('provider reference protection failed')
    const protectedReference = await options.db
      .prepare(
        `SELECT attempt_id
         FROM protected_provider_references
         WHERE environment = ? AND provider = 'meta' AND provider_account_key = ?
           AND reference_type = 'message_id' AND fingerprint = ?
           AND attempt_id = ? AND erased_at IS NULL
         LIMIT 1`
      )
      .bind(options.environment, input.providerAccountKey, fingerprint, input.attemptId)
      .first<{ attempt_id: string }>()
    if (!protectedReference)
      throw new Error('provider reference correlation was not persisted')
    return fingerprint
  }
