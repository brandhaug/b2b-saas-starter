import { Effect, Layer } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import {
  TransactionalEmail,
  makeConfiguredTransactionalEmailProvider,
  makeLiveTransactionalEmailLayer
} from '@b2b-saas-starter/capabilities/notifications'
import type { ApiEnv } from './env.ts'

export const isTransactionalEmailCallbackPath = (request: Request) =>
  new URL(request.url).pathname === '/callbacks/email/transactional'

export const handleTransactionalEmailCallback = async (
  request: Request,
  env: ApiEnv
): Promise<Response> => {
  if (request.method !== 'POST')
    return new Response('Method Not Allowed', { status: 405 })
  if (
    !env.DB ||
    !env.CLOUDFLARE_EMAIL_FROM ||
    env.TRANSACTIONAL_EMAIL_SENDER_VERIFIED !== 'true' ||
    !env.TRANSACTIONAL_EMAIL_CALLBACK_SECRET
  )
    return Response.json(
      { code: 'transactional_email_needs_configuration' },
      { status: 503 }
    )
  const rawBody = await request.text()
  const timestamp = request.headers.get('webhook-timestamp') ?? ''
  const signature = request.headers.get('webhook-signature') ?? ''
  const now = new Date().toISOString()
  const provider = makeConfiguredTransactionalEmailProvider({
    sender: env.CLOUDFLARE_EMAIL_FROM,
    callbackSecret: env.TRANSACTIONAL_EMAIL_CALLBACK_SECRET,
    send: async () => {
      throw new Error('callback-only provider')
    }
  })
  const result = await Effect.runPromise(
    Effect.result(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.receiveCallback({ rawBody, timestamp, signature, now })
      ).pipe(
        Effect.provide(
          makeLiveTransactionalEmailLayer(provider).pipe(
            Layer.provide(layerFromD1(env.DB!))
          )
        )
      )
    )
  )
  if (result._tag === 'Failure')
    return new Response('Invalid callback', { status: 400 })
  return new Response(null, { status: result.success === 'ignored' ? 202 : 204 })
}
