import { Effect } from 'effect'
import { acceptSmsoCallbackHint } from '@b2b-saas-starter/capabilities/notifications/providers/smso'

type CallbackStatement = {
  readonly bind: (...values: unknown[]) => CallbackStatement
  readonly all: <T>() => Promise<{ readonly results: readonly T[] }>
}

export type SmsoCallbackEnv = {
  readonly DB?: { readonly prepare: (sql: string) => CallbackStatement }
  readonly BOOKING_EVENTS_QUEUE?: {
    readonly send: (body: unknown) => Promise<unknown>
  }
  readonly ENVIRONMENT?: string
  readonly SMSO_CALLBACK_PATH_SECRET?: string
  readonly SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY?: string
}

const safeEqual = (left: string, right: string) => {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1)
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  return difference === 0
}

export const isSmsoCallbackPath = (request: Request) =>
  new URL(request.url).pathname.startsWith('/callbacks/smso/')

const readBoundedBody = async (request: Request, maximumBytes: number) => {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximumBytes) return null
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      byteLength += next.value.byteLength
      if (byteLength > maximumBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export const handleSmsoCallbackEdge = async (
  request: Request,
  env: SmsoCallbackEnv
): Promise<Response> => {
  const configuredSecret = env.SMSO_CALLBACK_PATH_SECRET?.trim()
  const fingerprintSecret = env.SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY?.trim()
  if (!configuredSecret || !fingerprintSecret || !env.DB)
    return new Response(null, { status: 503 })
  let suppliedSecret: string
  try {
    suppliedSecret = decodeURIComponent(
      new URL(request.url).pathname.slice('/callbacks/smso/'.length)
    )
  } catch {
    return new Response(null, { status: 404 })
  }
  if (!safeEqual(suppliedSecret, configuredSecret))
    return new Response(null, { status: 404 })
  if (request.method !== 'POST')
    return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  const rejection = await env.DB.prepare(
    `SELECT enabled FROM messaging_callback_rejection_rules
     WHERE environment = ? AND provider = 'smso' AND rule_key = 'sms'
     LIMIT 1`
  )
    .bind(env.ENVIRONMENT ?? 'production')
    .all<{ enabled: number }>()
  if (rejection.results[0]?.enabled === 1)
    return new Response(null, {
      status: 503,
      headers: { 'retry-after': '30', 'cache-control': 'no-store' }
    })
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/x-www-form-urlencoded')
  )
    return new Response(null, { status: 415 })
  const bytes = await readBoundedBody(request, 4_096)
  if (!bytes) return new Response(null, { status: 413 })
  const outcome = await Effect.runPromise(
    acceptSmsoCallbackHint({
      db: env.DB,
      environment: env.ENVIRONMENT ?? 'production',
      providerAccountKey: 'platform-smso',
      fingerprintSecret,
      rawBody: new TextDecoder().decode(bytes),
      publishWakeup: env.BOOKING_EVENTS_QUEUE
        ? (intentId) =>
            Effect.tryPromise({
              try: () =>
                env.BOOKING_EVENTS_QUEUE!.send({
                  version: 1,
                  kind: 'notification-intent',
                  intentId
                }),
              catch: (error) => error
            }).pipe(
              Effect.asVoid,
              Effect.catch(() => Effect.void)
            )
        : () => Effect.void
    })
  )
  if (outcome._tag === 'rejected')
    return new Response(null, {
      status: outcome.code === 'payload_too_large' ? 413 : 400
    })
  return new Response(null, { status: 202 })
}
