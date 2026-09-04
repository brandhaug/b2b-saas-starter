import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { walkKeysetPages } from '@b2b-saas-starter/capabilities/internal/keyset-cursor'
import { describe, expect, test } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { buildWebHandler } from './http.ts'

/**
 * The REST paging contract, end to end over the worker's web handler
 * (ADR 0057): every list endpoint answers `{ items, nextCursor }`, honors
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
    const result = yield* walkKeysetPages((input) =>
      Effect.gen(function* () {
        let pagePath = path
        if (input.cursor !== undefined) {
          let separator = '?'
          if (path.includes('?')) {
            separator = '&'
          }
          pagePath = `${path}${separator}cursor=${encodeURIComponent(input.cursor)}`
        }
        const response: Response = yield* send(get(pagePath))
        expect(response.status).toBe(200)
        const page: {
          readonly items: ReadonlyArray<{ readonly id: string }>
          readonly nextCursor: string | null
        } = yield* jsonBody(response, PageBody)
        return page
      })
    )
    // The cursor chain must terminate; a server that never answers
    // `nextCursor: null` stops the walk and dies here.
    if (!result.exhausted) {
      return yield* Effect.die(new Error('paging walk never terminated'))
    }
    return result.items.map((item) => item.id)
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
        expect(page.items.map((item) => item.id)).toEqual(['not_email', 'not_export'])
        expect(page.nextCursor).not.toBe(null)

        const resumed = yield* send(
          get(
            `/workspaces/starter-lab/notifications?limit=2&cursor=${encodeURIComponent(page.nextCursor ?? '')}`
          )
        )
        const nextPage = yield* jsonBody(resumed, PageBody)
        expect(nextPage.items.map((item) => item.id)).toEqual([
          'not_webhook',
          'not_token'
        ])
      })
    ))

  test('a walk with a small limit covers the collection once, newest first', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const ids = yield* walk('/workspaces/starter-lab/notifications?limit=2')
        expect(ids).toEqual([
          'not_email',
          'not_export',
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
        // The seed fixture holds two workspace-scoped audit events, so the
        // newest-first first page holds one and names the next.
        expect(page.items).toHaveLength(1)
        expect(page.items[0]?.id).toBe('aud_export')
        expect(page.nextCursor).not.toBe(null)
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
        expect(page.items).toHaveLength(7)
        expect(page.nextCursor).toBe(null)
      })
    ))
})
