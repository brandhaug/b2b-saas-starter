import { Effect } from 'effect'
import {
  captureMetaCallbackReceipt,
  decodeMetaCallbackEvents,
  ingestMetaCallbackEvents,
  type MetaCallbackEvent
} from '@b2b-saas-starter/capabilities/notifications'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { layerFromD1 } from '@b2b-saas-starter/db'
import type { ApiEnv } from './env.ts'

const toHex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

export const signMetaBody = async (
  secret: string,
  body: Uint8Array
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return toHex(await crypto.subtle.sign('HMAC', key, Uint8Array.from(body).buffer))
}

const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

const digest = async (body: Uint8Array) =>
  `sha256:${toHex(await crypto.subtle.digest('SHA-256', Uint8Array.from(body).buffer))}`

const empty = (status: number, headers?: HeadersInit) =>
  new Response(null, { status, ...(headers ? { headers } : {}) })

export const makeMetaWhatsAppCallbackHandler =
  (options: {
    readonly appSecret: string
    readonly verifyToken: string
    readonly maxBodyBytes: number
    readonly captureReceipt: (input: {
      readonly rawBodyDigest: string
      readonly receivedAt: string
      readonly byteLength: number
      readonly eventCount: number
    }) => Promise<void>
    readonly ingest: (
      events: readonly MetaCallbackEvent[],
      receivedAt: string
    ) => Promise<{
      readonly intentIds: readonly string[]
      readonly unresolvedCount: number
    }>
    readonly wake?: (intentId: string) => Promise<void>
    readonly now?: () => string
  }) =>
  async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode')
      const token = url.searchParams.get('hub.verify_token')
      const challenge = url.searchParams.get('hub.challenge')
      if (
        mode !== 'subscribe' ||
        token !== options.verifyToken ||
        !challenge ||
        challenge.length > 256
      )
        return empty(403)
      return new Response(challenge, {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store'
        }
      })
    }
    if (request.method !== 'POST') return empty(405, { Allow: 'GET, POST' })
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > options.maxBodyBytes)
      return empty(413)
    const rawBody = new Uint8Array(await request.arrayBuffer())
    if (rawBody.byteLength > options.maxBodyBytes) return empty(413)
    const signature = request.headers.get('x-hub-signature-256')
    if (!signature?.startsWith('sha256=')) return empty(401)
    const expected = await signMetaBody(options.appSecret, rawBody)
    if (!constantTimeEqual(signature.slice(7).toLowerCase(), expected))
      return empty(401)
    const receivedAt = (options.now ?? (() => new Date().toISOString()))()
    const decoded = await Effect.runPromise(
      Effect.result(
        decodeMetaCallbackEvents(new TextDecoder().decode(rawBody), receivedAt)
      )
    )
    if (decoded._tag === 'Failure') return empty(400)
    const events = decoded.success
    await options.captureReceipt({
      rawBodyDigest: await digest(rawBody),
      receivedAt,
      byteLength: rawBody.byteLength,
      eventCount: events.length
    })
    const ingestion = await options.ingest(events, receivedAt)
    if (options.wake)
      await Promise.all(
        [...new Set(ingestion.intentIds)].map((intentId) =>
          options.wake!(intentId).catch(() => undefined)
        )
      )
    if (ingestion.unresolvedCount > 0) return empty(503, { 'retry-after': '30' })
    return empty(200)
  }

export const makeD1MetaWhatsAppCallbackHandler = (env: ApiEnv) => {
  const appSecret = env.META_WHATSAPP_APP_SECRET?.trim()
  const verifyToken = env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim()
  const fingerprintSecret = env.META_WHATSAPP_REFERENCE_FINGERPRINT_KEY?.trim()
  const providerAccountKey =
    env.META_WHATSAPP_PROVIDER_ACCOUNT_KEY?.trim() || 'platform-meta'
  const notConfigured = async () =>
    Response.json(
      {
        error: {
          code: 'needs_configuration',
          message: 'Meta callback is not configured.'
        }
      },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    )
  if (!verifyToken) return notConfigured
  if (!env.DB || !appSecret || !fingerprintSecret) {
    const challengeOnly = makeMetaWhatsAppCallbackHandler({
      appSecret: '',
      verifyToken,
      maxBodyBytes: 0,
      captureReceipt: async () => undefined,
      ingest: async () => ({ intentIds: [], unresolvedCount: 0 })
    })
    return (request: Request) =>
      request.method === 'GET' ? challengeOnly(request) : notConfigured()
  }
  const environment = env.ENVIRONMENT ?? 'development'
  const capabilities = selectCapabilitiesLayer({ DB: env.DB })
  const database = layerFromD1(env.DB)
  return makeMetaWhatsAppCallbackHandler({
    appSecret,
    verifyToken,
    maxBodyBytes: 64 * 1024,
    captureReceipt: (input) =>
      Effect.runPromise(
        captureMetaCallbackReceipt({
          ...input,
          environment,
          providerAccountKey
        }).pipe(Effect.provide(database))
      ),
    ingest: async (events, receivedAt) =>
      Effect.runPromise(
        ingestMetaCallbackEvents({
          events,
          receivedAt,
          environment,
          providerAccountKey,
          fingerprintSecret
        }).pipe(Effect.provide(capabilities), Effect.provide(database))
      ),
    ...(env.BOOKING_EVENTS_QUEUE
      ? {
          wake: async (intentId: string) => {
            await env.BOOKING_EVENTS_QUEUE!.send({
              version: 1,
              kind: 'notification-intent',
              intentId
            })
          }
        }
      : {})
  })
}
