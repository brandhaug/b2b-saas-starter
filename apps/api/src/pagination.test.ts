import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { describe, expect, test } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { buildWebHandler } from './http.ts'

/**
 * The REST paging contract, end to end over the worker's web handler
 * (ADR 0054): every list endpoint answers `{ items, nextCursor }`, honors
 * `limit`, resumes from `cursor`, and clamps or empties gracefully. The
 * cursor codec's stability-across-inserts is proven at the capability
 * contracts (Seed and Live); what this file owns is the wire surface.
 */

const bearer = { authorization: `Bearer ${SEED_API_TOKEN}` }

const PageBody = Schema.Struct({
  items: Schema.Array(Schema.Struct({ id: Schema.String })),
  nextCursor: Schema.NullOr(Schema.String)
})

function get(path: string): Request {
  return new Request(`https://api.test${path}`, { headers: bearer })
}

function send(request: Request): Effect.Effect<Response> {
  return Effect.promise(() => buildWebHandler({}).handler(request))
}

function jsonBody<S extends Schema.Top>(
  response: Response,
  schema: S
): Effect.Effect<S['Type'], never, S['DecodingServices']> {
  return Effect.promise(() => response.json()).pipe(
    Effect.flatMap((body) => Schema.decodeUnknownEffect(schema)(body)),
    Effect.orDie
  )
}

/** Walks one endpoint cursor-to-cursor, collecting item ids. */
function walk(path: string) {
  return Effect.gen(function* () {
    const ids: Array<string> = []
    // Annotated: the cursor's type must not be inferred from the page body,
    // or the loop's initializer would reference itself.
    let cursor: string | null = null
    let continueWalking = true
    for (let guard = 0; guard < 25 && continueWalking; guard += 1) {
      let separator = '?'
      if (path.includes('?')) {
        separator = '&'
      }
      let pagePath = path
      if (cursor !== null) {
        pagePath = `${path}${separator}cursor=${encodeURIComponent(cursor)}`
      }
      const response: Response = yield* send(get(pagePath))
      expect(response.status).toBe(200)
      const page: {
        readonly items: ReadonlyArray<{ readonly id: string }>
        readonly nextCursor: string | null
      } = yield* jsonBody(response, PageBody)
      for (const item of page.items) {
        ids.push(item.id)
      }
      cursor = page.nextCursor
      continueWalking = cursor !== null
    }
    if (cursor !== null) {
      return yield* Effect.die(new Error('paging walk never terminated'))
    }
    return ids
  })
}

describe('REST list paging', () => {
  test('every list endpoint answers the Page shape with no params', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        for (const path of [
          '/workspaces/starter-lab/members',
          '/workspaces/starter-lab/notifications',
          '/workspaces/starter-lab/api-tokens',
          '/workspaces/starter-lab/webhooks'
        ]) {
          const response = yield* send(get(path))
          expect(response.status).toBe(200)
          const page = yield* jsonBody(response, PageBody)
          expect(page.items.length).toBeGreaterThan(0)
          // The seed collections are smaller than the default page, so the
          // first page is the last one.
          expect(page.nextCursor).toBe(null)
        }
      })
    ))

  test('limit narrows the page and the cursor resumes exactly after it', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* send(
          get('/workspaces/starter-lab/notifications?limit=2')
        )
        const page = yield* jsonBody(response, PageBody)
        expect(page.items).toHaveLength(2)
        expect(page.items.map((item) => item.id)).toEqual(['not_email', 'not_webhook'])
        expect(page.nextCursor).not.toBe(null)

        const resumed = yield* send(
          get(
            `/workspaces/starter-lab/notifications?limit=2&cursor=${encodeURIComponent(page.nextCursor ?? '')}`
          )
        )
        const nextPage = yield* jsonBody(resumed, PageBody)
        expect(nextPage.items.map((item) => item.id)).toEqual([
          'not_token',
          'not_billing'
        ])
      })
    ))

  test('a walk with a small limit covers the collection once, newest first', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const ids = yield* walk('/workspaces/starter-lab/notifications?limit=2')
        expect(ids).toEqual([
          'not_email',
          'not_webhook',
          'not_token',
          'not_billing',
          'not_rotation',
          'not_invite'
        ])
      })
    ))

  test('audit events honor limit', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* send(
          get('/workspaces/starter-lab/audit-events?limit=1')
        )
        const page = yield* jsonBody(response, PageBody)
        // The seed fixture holds one workspace-scoped audit event, so the
        // first page is also the last — a full short page names no cursor.
        expect(page.items).toHaveLength(1)
        expect(page.items[0]?.id).toBe('aud_token')
        expect(page.nextCursor).toBe(null)
      })
    ))

  test('an undecodable cursor addresses no position instead of failing', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* send(
          get('/workspaces/starter-lab/notifications?cursor=not-a-cursor')
        )
        expect(response.status).toBe(200)
        const page = yield* jsonBody(response, PageBody)
        expect(page.items).toHaveLength(0)
        expect(page.nextCursor).toBe(null)
      })
    ))

  test('an out-of-range limit clamps instead of failing', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        for (const limit of ['0', '-5', '999999']) {
          const response = yield* send(
            get(`/workspaces/starter-lab/notifications?limit=${limit}`)
          )
          expect(response.status).toBe(200)
          const page = yield* jsonBody(response, PageBody)
          expect(page.items.length).toBeGreaterThan(0)
        }
      })
    ))

  test('an unusable limit falls back to the default page instead of failing', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* send(
          get('/workspaces/starter-lab/notifications?limit=abc')
        )
        expect(response.status).toBe(200)
        const page = yield* jsonBody(response, PageBody)
        expect(page.items).toHaveLength(6)
        expect(page.nextCursor).toBe(null)
      })
    ))
})
