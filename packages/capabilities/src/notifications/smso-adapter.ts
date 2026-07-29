import { Effect, Redacted } from 'effect'
import type {
  ProviderCallbackRequest,
  ProviderCostFact,
  ProviderQueryRequest,
  ProviderSubmissionRequest
} from './provider-contracts.ts'
import { ProviderContractFailure } from './provider-contracts.ts'

type SubmissionRequest = Extract<
  typeof ProviderSubmissionRequest.Type,
  { readonly provider: 'smso' }
>
type CallbackRequest = typeof ProviderCallbackRequest.Type
type QueryRequest = typeof ProviderQueryRequest.Type
type CostFact = typeof ProviderCostFact.Type

export type SmsoFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

export type SmsoAdapterOptions = {
  readonly apiKey: Redacted.Redacted<string>
  readonly senderId: string
  readonly callbackUrl: Redacted.Redacted<string>
  readonly fingerprintSecret: Redacted.Redacted<string>
  readonly providerAccountKey: string
  readonly environment: string
  readonly timeoutMs: number
  readonly fetch: SmsoFetch
  readonly now?: () => string
  readonly baseUrl?: string
  readonly maxCallbackBytes?: number
}

const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
)
const GSM_EXTENSION = new Set('^{}\\[~]|€')
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STATUS = new Set([
  'dispatched',
  'sent',
  'delivered',
  'undelivered',
  'expired',
  'error'
])
const CALLBACK_FIELDS = new Set([
  'uuid',
  'status',
  'sent_at',
  'delivered_at',
  'number',
  'mcc',
  'mnc'
])

const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )

const fingerprint = (secret: Redacted.Redacted<string>, value: string) =>
  Effect.promise(async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(Redacted.value(secret)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    return `sha256:${hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))}`
  })

const gsmSeptets = (body: string): number | null => {
  let count = 0
  for (const character of body) {
    if (GSM_BASIC.has(character)) count += 1
    else if (GSM_EXTENSION.has(character)) count += 2
    else return null
  }
  return count
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const retryAfter = (response: Response) => {
  const parsed = Number(response.headers.get('Retry-After') ?? '30')
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.ceil(parsed), 300) : 30
}

const providerInstant = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const parsed = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

const contractFailure = (
  operation: 'submit' | 'verify_callback' | 'query' | 'read_cost',
  reason: 'needs_configuration' | 'timeout' | 'transport' | 'malformed_evidence',
  code:
    | 'provider_not_configured'
    | 'provider_timeout'
    | 'provider_transport_error'
    | 'malformed_provider_evidence'
) => new ProviderContractFailure({ provider: 'smso', operation, reason, code })

export const makeSmsoAdapter = (options: SmsoAdapterOptions) => {
  const now = options.now ?? (() => new Date().toISOString())
  const baseUrl = (options.baseUrl ?? 'https://app.smso.ro/api/v1').replace(/\/$/, '')
  const maxCallbackBytes = options.maxCallbackBytes ?? 4_096
  const costs = new Map<string, CostFact>()
  const configured =
    Redacted.value(options.apiKey).trim().length > 0 &&
    options.senderId.trim().length > 0 &&
    Redacted.value(options.callbackUrl).trim().length > 0 &&
    Redacted.value(options.fingerprintSecret).trim().length > 0

  const submit = (request: SubmissionRequest) =>
    Effect.gen(function* () {
      if (!configured)
        return yield* Effect.fail(
          contractFailure('submit', 'needs_configuration', 'provider_not_configured')
        )
      const body = Redacted.value(request.renderedBody)
      const septets = gsmSeptets(body)
      if (septets === null || septets < 1 || septets > 160)
        return {
          _tag: 'rejected' as const,
          classification: 'terminal' as const,
          code: 'provider_rejected' as const
        }

      const form = new URLSearchParams({
        to: Redacted.value(request.destination),
        sender: options.senderId,
        body,
        type: 'transactional',
        webhook_status: Redacted.value(options.callbackUrl)
      })
      const result = yield* Effect.result(
        Effect.tryPromise({
          try: () =>
            options.fetch(`${baseUrl}/send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Authorization': Redacted.value(options.apiKey),
                'X-Source-App': 'beesolo-operational-messaging/1'
              },
              body: form,
              signal: AbortSignal.timeout(Math.max(250, options.timeoutMs))
            }),
          catch: (error) => error
        })
      )
      if (result._tag === 'Failure')
        return { _tag: 'ambiguous' as const, observedAt: now() }
      const response = result.success
      if (response.status === 409)
        return { _tag: 'ambiguous' as const, observedAt: now() }
      if (response.status === 429)
        return {
          _tag: 'throttled' as const,
          retryAfterSeconds: retryAfter(response)
        }
      if (response.status >= 500)
        return { _tag: 'ambiguous' as const, observedAt: now() }
      if ([400, 401, 402, 403, 405, 422].includes(response.status))
        return {
          _tag: 'rejected' as const,
          classification: 'terminal' as const,
          code: 'provider_rejected' as const
        }
      const decoded = asRecord(
        yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (error) => error
        }).pipe(Effect.orElseSucceed(() => null))
      )
      const token = decoded?.responseToken
      const transactionCost = decoded?.transaction_cost
      if (
        !response.ok ||
        decoded?.status !== 200 ||
        typeof token !== 'string' ||
        !UUID.test(token) ||
        typeof transactionCost !== 'number' ||
        !Number.isFinite(transactionCost) ||
        transactionCost < 0
      )
        return yield* Effect.fail(
          contractFailure('submit', 'malformed_evidence', 'malformed_provider_evidence')
        )
      const tokenFingerprint = yield* fingerprint(options.fingerprintSecret, token)
      costs.set(request.attemptId, {
        costFactId: `pcst_${request.attemptId}`,
        attemptId: request.attemptId,
        intentId: request.intentId,
        provider: 'smso',
        amountMilliEuro: Math.round(transactionCost * 10),
        currency: 'EUR',
        units: 1,
        recordedAt: now(),
        source: 'response'
      })
      return {
        _tag: 'accepted' as const,
        providerReferenceFingerprint: tokenFingerprint,
        protectedProviderReference: Redacted.make(token),
        costFacts: [costs.get(request.attemptId)!],
        acceptedAt: now()
      }
    })

  const verifyCallback = (request: CallbackRequest) =>
    Effect.gen(function* () {
      if (request.provider !== 'smso')
        return { _tag: 'rejected' as const, code: 'malformed_callback' as const }
      return yield* verifySmsoCallbackHint({
        rawBody: Redacted.value(request.rawBody),
        fingerprintSecret: options.fingerprintSecret,
        maxCallbackBytes
      })
    })

  const query = (request: QueryRequest) =>
    Effect.gen(function* () {
      if (request.provider !== 'smso')
        return yield* Effect.fail(
          new ProviderContractFailure({
            provider: 'smso',
            operation: 'query',
            reason: 'malformed_evidence',
            code: 'provider_mismatch'
          })
        )
      if (!configured)
        return yield* Effect.fail(
          contractFailure('query', 'needs_configuration', 'provider_not_configured')
        )
      const token = Redacted.value(request.providerReference)
      if (!UUID.test(token))
        return yield* Effect.fail(
          contractFailure('query', 'malformed_evidence', 'malformed_provider_evidence')
        )
      const actualFingerprint = yield* fingerprint(options.fingerprintSecret, token)
      if (actualFingerprint !== request.providerReferenceFingerprint)
        return yield* Effect.fail(
          contractFailure('query', 'malformed_evidence', 'malformed_provider_evidence')
        )
      const result = yield* Effect.result(
        Effect.tryPromise({
          try: () =>
            options.fetch(`${baseUrl}/status`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: new URLSearchParams({ responseToken: token }),
              signal: AbortSignal.timeout(Math.max(250, options.timeoutMs))
            }),
          catch: (error) => error
        })
      )
      if (result._tag === 'Failure') {
        const timedOut =
          result.failure instanceof DOMException &&
          (result.failure.name === 'AbortError' ||
            result.failure.name === 'TimeoutError')
        return yield* Effect.fail(
          timedOut
            ? contractFailure('query', 'timeout', 'provider_timeout')
            : contractFailure('query', 'transport', 'provider_transport_error')
        )
      }
      const response = result.success
      if (response.status === 404) return { _tag: 'not_found' as const }
      if (response.status === 409 || response.status === 429)
        return {
          _tag: 'throttled' as const,
          retryAfterSeconds: retryAfter(response)
        }
      if (!response.ok)
        return yield* Effect.fail(
          contractFailure('query', 'transport', 'provider_transport_error')
        )
      const decoded = asRecord(
        yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (error) => error
        }).pipe(Effect.orElseSucceed(() => null))
      )
      const status = decoded?.status
      if (typeof status !== 'string' || !STATUS.has(status))
        return yield* Effect.fail(
          contractFailure('query', 'malformed_evidence', 'malformed_provider_evidence')
        )
      if (status === 'dispatched' || status === 'sent')
        return { _tag: 'not_found' as const }
      const occurredAt = providerInstant(decoded?.delivered_at ?? decoded?.sent_at)
      return {
        _tag: 'evidence' as const,
        evidence: {
          evidenceId: `pevd_${request.attemptId}_${status}`,
          attemptId: request.attemptId,
          intentId: request.intentId,
          provider: 'smso' as const,
          source: 'query' as const,
          status:
            status === 'delivered'
              ? ('delivered' as const)
              : ('terminal_failure' as const),
          observedAt: now(),
          ...(occurredAt ? { providerOccurredAt: occurredAt } : {}),
          providerReferenceFingerprint: request.providerReferenceFingerprint,
          trusted: true,
          ...(status === 'delivered'
            ? {}
            : { code: 'provider_terminal_failure' as const })
        }
      }
    })

  const readCosts = (attemptId: string) =>
    Effect.succeed(costs.has(attemptId) ? [costs.get(attemptId)!] : [])

  return {
    runtimeState: configured
      ? ('configured' as const)
      : ('needs_configuration' as const),
    submit,
    verifyCallback,
    query,
    readCosts,
    providerAccountKey: options.providerAccountKey,
    environment: options.environment
  }
}

export const verifySmsoCallbackHint = (input: {
  readonly rawBody: string
  readonly fingerprintSecret: Redacted.Redacted<string>
  readonly maxCallbackBytes?: number
}) =>
  Effect.gen(function* () {
    if (
      new TextEncoder().encode(input.rawBody).byteLength >
      (input.maxCallbackBytes ?? 4_096)
    )
      return { _tag: 'rejected' as const, code: 'payload_too_large' as const }
    const form = new URLSearchParams(input.rawBody)
    const uuid = form.get('uuid')
    const status = form.get('status')
    const keys = [...form.keys()]
    if (
      !uuid ||
      !UUID.test(uuid) ||
      !status ||
      !STATUS.has(status) ||
      keys.some((key) => !CALLBACK_FIELDS.has(key)) ||
      form.getAll('uuid').length !== 1 ||
      form.getAll('status').length !== 1
    )
      return { _tag: 'rejected' as const, code: 'malformed_callback' as const }
    return {
      _tag: 'untrusted_hint' as const,
      providerReferenceFingerprint: yield* fingerprint(input.fingerprintSecret, uuid)
    }
  })

export type SmsoAdapter = ReturnType<typeof makeSmsoAdapter>
