import { Effect, FileSystem, Layer, Path } from 'effect'
import {
  Etag,
  HttpPlatform,
  HttpRouter,
  HttpServerResponse
} from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type {
  WalkInAcknowledgment,
  WalkInEnrollment,
  WalkInOverview,
  WalkInQueueEntry
} from '@b2b-saas-starter/capabilities/walk-ins'
import { WalkInHttpApi } from './walk-in-http-api.ts'

export type WalkInHttpDependencies = {
  readonly resolveShop: (
    slug: string
  ) => Effect.Effect<{ readonly id: string }, unknown>
  readonly overview: (shopId: string) => Effect.Effect<WalkInOverview, unknown>
  readonly enroll: (
    input: WalkInEnrollment
  ) => Effect.Effect<WalkInAcknowledgment, unknown>
  readonly inspect: (input: {
    shopId: string
    entryId: string
    capability: string
  }) => Effect.Effect<WalkInQueueEntry, unknown>
}

const cookieName = (entryId: string) => `__Secure-walk-in-${entryId}`
const readCookie = (header: string | undefined, name: string) =>
  header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
const json = (value: unknown, status = 200, headers?: Record<string, string>) =>
  HttpServerResponse.jsonUnsafe(value, {
    status,
    headers: { 'cache-control': 'no-store', 'x-walk-in-api': 'handled', ...headers }
  })
const failure = (error: unknown) => {
  const tag = (error as { _tag?: string })._tag
  if (tag === 'WalkInsClosed') return json({ error: 'walk_ins_closed' }, 409)
  if (tag === 'WalkInDuplicate') return json({ error: 'walk_in_duplicate' }, 409)
  if (tag === 'WalkInUnavailable' || tag === 'CapabilityUnavailable')
    return json({ error: 'walk_ins_unavailable' }, 503)
  if (tag === 'WalkInEntryNotFound' || tag === 'ShopNotFound')
    return json({ error: 'walk_in_not_found' }, 404)
  return json({ error: 'walk_in_invalid' }, 400)
}

const handlers = (dependencies: WalkInHttpDependencies) =>
  HttpApiBuilder.group(WalkInHttpApi, 'walk-ins', (group) =>
    group
      .handle('overview', ({ params }) =>
        dependencies.resolveShop(params.shopSlug).pipe(
          Effect.flatMap((shop) => dependencies.overview(shop.id)),
          Effect.map((value) => json(value)),
          Effect.catch((error) => Effect.succeed(failure(error)))
        )
      )
      .handle('enroll', ({ params, payload, request }) =>
        dependencies.resolveShop(params.shopSlug).pipe(
          Effect.flatMap((shop) =>
            dependencies.enroll({ ...payload, shopId: shop.id })
          ),
          Effect.map((result) => {
            const url = new URL(request.url, 'https://booking.invalid')
            return json(
              { entry: result.entry, location: `${url.pathname}/${result.entry.id}` },
              201,
              {
                'set-cookie': `${cookieName(result.entry.id)}=${encodeURIComponent(result.acknowledgment.capability)}; Path=${url.pathname}/${result.entry.id}; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(1, Math.floor((Date.parse(result.acknowledgment.expiresAt) - Date.now()) / 1000))}`
              }
            )
          }),
          Effect.catch((error) => Effect.succeed(failure(error)))
        )
      )
      .handle('inspect', ({ params, request }) => {
        const capability = readCookie(
          request.headers.cookie,
          cookieName(params.entryId)
        )
        if (!capability)
          return Effect.succeed(json({ error: 'walk_in_not_found' }, 404))
        return dependencies.resolveShop(params.shopSlug).pipe(
          Effect.flatMap((shop) =>
            dependencies.inspect({
              shopId: shop.id,
              entryId: params.entryId,
              capability
            })
          ),
          Effect.map((value) => json(value)),
          Effect.catch((error) => Effect.succeed(failure(error)))
        )
      })
  )

const PlatformLive = Layer.mergeAll(
  Path.layer,
  Etag.layer,
  FileSystem.layerNoop({}),
  HttpPlatform.layer.pipe(Layer.provide(FileSystem.layerNoop({})))
)

export const handleWalkInRequest = async (
  request: Request,
  dependencies: WalkInHttpDependencies
): Promise<Response | null> => {
  if (!new URL(request.url).pathname.includes('/walk-ins')) return null
  const api = HttpApiBuilder.layer(WalkInHttpApi).pipe(
    Layer.provide(handlers(dependencies)),
    Layer.provide(PlatformLive)
  )
  const built = HttpRouter.toWebHandler(api, { disableLogger: true })
  try {
    const response = await built.handler(request)
    return response.headers.get('x-walk-in-api') === 'handled' ? response : null
  } finally {
    await built.dispose()
  }
}
