import {
  CreatedApiTokenSchema,
  ReplacedApiTokenSchema,
  SEED_API_TOKEN
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { buildWebHandler } from './http.ts'
import { jsonBody } from './test-utils.ts'

const Failure = Schema.Struct({ _tag: Schema.String })
const encodeBody = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

function client() {
  const { handler } = buildWebHandler({})
  return (
    method: string,
    path: string,
    body?: typeof Schema.Json.Type,
    token = SEED_API_TOKEN
  ) => {
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
      handler(new Request(`https://api.test${path}`, options))
    )
  }
}

const tokensPath = '/workspaces/starter-lab/api-tokens'
const expiresAt = '2099-01-01T00:00:00.000Z'

it.effect(
  'REST preserves expiry, replaces once, and immediately retires the old bearer',
  () =>
    Effect.gen(function* () {
      const send = client()
      const response = yield* send('POST', tokensPath, {
        name: 'CI',
        scopes: ['read'],
        expiresAt
      })
      expect(response.status).toBe(201)
      const original = yield* jsonBody(response, CreatedApiTokenSchema)
      expect(original.expiresAt).toBe(expiresAt)
      const replacedResponse = yield* send(
        'POST',
        `${tokensPath}/${original.id}/replace`,
        {
          scopes: ['read'],
          overlapSeconds: 0
        }
      )
      expect(replacedResponse.status).toBe(201)
      const replacement = yield* jsonBody(replacedResponse, ReplacedApiTokenSchema)
      expect(replacement.previousTokenId).toBe(original.id)
      expect(replacement.expiresAt).toBe(expiresAt)
      expect(replacement.token).not.toBe(original.token)
      expect((yield* send('GET', tokensPath, undefined, original.token)).status).toBe(
        401
      )
      expect(
        (yield* send('GET', tokensPath, undefined, replacement.token)).status
      ).toBe(200)
      const repeat = yield* send('POST', `${tokensPath}/${original.id}/replace`, {
        scopes: ['read'],
        overlapSeconds: 0
      })
      expect(repeat.status).toBe(409)
      expect((yield* jsonBody(repeat, Failure))._tag).toBe('ApiTokenNotRotatable')
    })
)

it.effect('REST rejects expiry and rotation inputs without retiring the source', () =>
  Effect.gen(function* () {
    const send = client()
    for (const expiry of ['not-a-date', '2000-01-01T00:00:00.000Z']) {
      expect(
        (yield* send('POST', tokensPath, {
          name: 'Bad expiry',
          scopes: ['read'],
          expiresAt: expiry
        })).status
      ).toBe(400)
    }
    const original = yield* send('POST', tokensPath, {
      name: 'CI',
      scopes: ['read'],
      expiresAt
    }).pipe(Effect.flatMap((response) => jsonBody(response, CreatedApiTokenSchema)))
    for (const payload of [
      { scopes: ['admin'], overlapSeconds: 0 },
      { scopes: ['read'], overlapSeconds: -1 },
      { scopes: ['read'], overlapSeconds: 86_401 },
      { scopes: ['read'], overlapSeconds: 0.5 },
      { scopes: [], overlapSeconds: 0 },
      { scopes: ['read'], overlapSeconds: 0, expiresAt: '2100-01-01T00:00:00.000Z' }
    ]) {
      expect(
        (yield* send('POST', `${tokensPath}/${original.id}/replace`, payload)).status
      ).toBe(400)
    }
    expect((yield* send('GET', tokensPath, undefined, original.token)).status).toBe(200)
    const foreign = yield* send(
      'POST',
      `/workspaces/another-workspace/api-tokens/${original.id}/replace`,
      {
        scopes: ['read'],
        overlapSeconds: 0
      }
    )
    expect(foreign.status).toBe(403)
    expect((yield* jsonBody(foreign, Failure))._tag).toBe('AuthorizationDenied')
    expect((yield* send('GET', tokensPath, undefined, original.token)).status).toBe(200)
  })
)
