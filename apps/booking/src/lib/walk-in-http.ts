import { Schema } from 'effect'
import {
  WalkInEnrollment,
  type WalkInAcknowledgment,
  type WalkInQueueEntry
} from '@b2b-saas-starter/capabilities/walk-ins'

type Dependencies = {
  readonly resolveShop: (slug: string) => Promise<{ readonly id: string }>
  readonly queue: (shopId: string) => Promise<readonly WalkInQueueEntry[]>
  readonly enroll: (
    input: typeof WalkInEnrollment.Type
  ) => Promise<WalkInAcknowledgment>
  readonly inspect: (input: {
    shopId: string
    entryId: string
    capability: string
  }) => Promise<WalkInQueueEntry>
}

const json = (value: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store', ...headers }
  })
const cookieName = (entryId: string) => `__Host-walk-in-${entryId}`
const cookie = (request: Request, name: string) =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)

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

export const handleWalkInRequest = async (
  request: Request,
  dependencies: Dependencies
): Promise<Response | null> => {
  const url = new URL(request.url)
  const match = url.pathname.match(
    /^\/[^/]+\/booking\/([^/]+)\/walk-ins(?:\/([^/]+))?$/
  )
  if (!match) return null
  try {
    const shop = await dependencies.resolveShop(match[1]!)
    const entryId = match[2]
    if (entryId) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
      const capability = cookie(request, cookieName(entryId))
      if (!capability) return json({ error: 'walk_in_not_found' }, 404)
      return json(await dependencies.inspect({ shopId: shop.id, entryId, capability }))
    }
    if (request.method === 'GET') return json(await dependencies.queue(shop.id))
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    const unknownBody = await request.json()
    const body = Schema.decodeUnknownSync(WalkInEnrollment)({
      ...(typeof unknownBody === 'object' && unknownBody !== null ? unknownBody : {}),
      shopId: shop.id
    })
    const result = await dependencies.enroll(body)
    return json(
      { entry: result.entry, location: `${url.pathname}/${result.entry.id}` },
      201,
      {
        'set-cookie': `${cookieName(result.entry.id)}=${encodeURIComponent(result.acknowledgment.capability)}; Path=${url.pathname}/${result.entry.id}; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(1, Math.floor((Date.parse(result.acknowledgment.expiresAt) - Date.now()) / 1000))}`
      }
    )
  } catch (error) {
    return failure(error)
  }
}
