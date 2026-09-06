import {
  ApiToken,
  SEED_API_TOKEN,
  SEED_READONLY_API_TOKEN
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { buildWebHandler } from './http.ts'

const Failure = Schema.Struct({ _tag: Schema.String })
// Bearer authentication legitimately updates lastUsedAt even when permission
// rejects a mutation. Compare lifecycle fields, not authentication telemetry.
const TokenLifecyclePage = Schema.Struct({
  items: Schema.Array(
    ApiToken.mapFields(({ lastUsedAt: _lastUsedAt, ...fields }) => fields)
  ),
  nextCursor: Schema.NullOr(Schema.String)
})
const decodeTokenLifecyclePage = Schema.decodeUnknownEffect(TokenLifecyclePage)
const encodeBody = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

it.effect('denied mutations leave the audit trail and token registry unchanged', () =>
  Effect.gen(function* () {
    const { handler } = buildWebHandler({})
    function send(
      method: string,
      path: string,
      token: string,
      body?: typeof Schema.Json.Type
    ) {
      const options: RequestInit = {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        }
      }
      if (body !== undefined) {
        options.body = encodeBody(body)
      }
      return Effect.promise(() =>
        handler(new Request(`https://api.test/workspaces/starter-lab/${path}`, options))
      )
    }
    const auditBefore = yield* send('GET', 'audit-events', SEED_API_TOKEN).pipe(
      Effect.flatMap((response) => Effect.promise(() => response.json()))
    )
    const tokensBefore = yield* send('GET', 'api-tokens', SEED_API_TOKEN).pipe(
      Effect.flatMap((response) => Effect.promise(() => response.json())),
      Effect.flatMap(decodeTokenLifecyclePage)
    )
    // Independent requests, deliberately not generated from catalog fixtures.
    // An absent target must still be denied before a capability can return 404.
    for (const route of [
      {
        method: 'POST',
        path: 'api-tokens',
        body: { name: 'Escalation', scopes: ['admin'] }
      },
      {
        method: 'POST',
        path: 'api-tokens/tok_absent/replace',
        body: { scopes: ['read'], overlapSeconds: 0 }
      },
      { method: 'DELETE', path: 'api-tokens/tok_seed' },
      { method: 'POST', path: 'exports' },
      { method: 'POST', path: 'exports/exp_absent/download-link' },
      {
        method: 'POST',
        path: 'webhooks',
        body: { url: 'https://hooks.example.com/x', events: ['api_token.created'] }
      },
      { method: 'PATCH', path: 'webhooks/wh_absent', body: { enabled: false } },
      { method: 'DELETE', path: 'webhooks/wh_absent' },
      { method: 'POST', path: 'webhooks/wh_absent/rotate-secret' },
      { method: 'POST', path: 'webhooks/wh_absent/test-event' },
      { method: 'POST', path: 'webhooks/deliveries/whd_absent/replay' }
    ]) {
      const response = yield* send(
        route.method,
        route.path,
        SEED_READONLY_API_TOKEN,
        route.body
      )
      expect(response.status).toBe(403)
      const failure = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Failure))
      )
      expect(failure._tag).toBe('AuthorizationDenied')
    }
    for (const { path, expected } of [
      { path: 'audit-events', expected: auditBefore },
      { path: 'api-tokens', expected: tokensBefore }
    ]) {
      const response = yield* send('GET', path, SEED_API_TOKEN)
      expect(response.status).toBe(200)
      const body = yield* Effect.promise(() => response.json())
      if (path === 'api-tokens') {
        expect(yield* decodeTokenLifecyclePage(body)).toEqual(expected)
      } else {
        expect(body).toEqual(expected)
      }
    }
  })
)
