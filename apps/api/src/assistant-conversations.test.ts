import { RateLimiter } from '@b2b-saas-starter/api'
import { AssistantConversationsApi } from '@b2b-saas-starter/api/assistant-conversations'
import { SeedAssistantDirectory } from '@b2b-saas-starter/capabilities/assistant/directory.seed'
import {
  SeedAssistantAuthority,
  type AssistantAuthorityState
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-authority'
import { AssistantConversationsLayer } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversations'
import {
  ConversationAcceptance,
  type ConversationAttempt,
  ConversationList,
  ConversationSummary
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { type AssistantConversationTransport } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation-transport'
import { WideEventLoggerLive } from '@b2b-saas-starter/logger'
import { describe, expect, it } from '@effect/vitest'
import { DateTime, Effect, FileSystem, Layer, Path, Schema } from 'effect'
import { Etag, HttpPlatform, HttpRouter } from 'effect/unstable/http'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { assistantConversationsGroup } from './assistant-conversation-handlers.ts'
import { assistantBearerAuth } from './assistant-conversation-guards.ts'
import {
  AssistantOAuthTokenVerifier,
  makeAssistantOAuthTokenVerifier
} from './assistant-oauth-access-token.ts'
import { jsonBody } from './test-utils.ts'

const resource = 'https://api.test/assistant'
const issuer = 'https://web.test/api/auth'
const expiresAt = 4_102_444_800_000
const proof = {
  expiresAt: DateTime.toDate(DateTime.makeUnsafe(expiresAt)),
  impersonatedBy: null,
  passwordVerifiedAt: null,
  strongAuthAt: null,
  strongAuthMethod: null,
  strongAuthCredentialId: null,
  recoveryUntil: null
}
const initialAuthority: AssistantAuthorityState = {
  context: {
    workspace: { id: 'wrk_rest', slug: 'rest-lab', name: 'REST lab', planId: 'free' },
    actor: { userId: 'usr_rest', role: 'member', systemRole: 'user' },
    actorType: 'user'
  },
  banned: false,
  suspended: false,
  currentSession: proof,
  retainedSession: { ...proof, revokedAt: null },
  totpId: null,
  passkeyIds: [],
  grant: { binding: 'consent_rest:0', scopes: ['assistant:read', 'assistant:write'] }
}
const attempt: ConversationAttempt = {
  id: 'attempt-1',
  questionId: 'question-1',
  createdAt: '2026-09-15T12:00:00Z',
  deadline: expiresAt,
  status: 'Running',
  reason: null,
  completedAt: null,
  provider: 'openai-compatible',
  modelId: 'gpt-4o-mini',
  providerRequestId: null,
  finishReason: null,
  inputTokens: null,
  outputTokens: null,
  omittedExchanges: 0,
  evidence: null
}
const accepted: ConversationAcceptance = {
  question: {
    id: 'question-1',
    createdAt: '2026-09-15T12:00:00Z',
    text: 'Explain',
    taskId: null
  },
  attempt,
  joined: false
}
const api = HttpApi.make('b2b-saas-starter').add(AssistantConversationsApi)
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))
const errorBody = Schema.Struct({ _tag: Schema.String })

const fixture = Effect.fn('AssistantRestTest.fixture')(function* () {
  const keys = yield* Effect.promise(() => generateKeyPair('EdDSA'))
  const jwk = yield* Effect.promise(() => exportJWK(keys.publicKey))
  let state: AssistantAuthorityState | null = initialAuthority
  let refusal: { status: number; body: Schema.Json } | undefined
  const calls: Array<Parameters<AssistantConversationTransport['request']>[0]> = []
  const transport: AssistantConversationTransport = {
    request: (input) => {
      calls.push(input)
      if (refusal !== undefined) {
        return Promise.resolve(Response.json(refusal.body, { status: refusal.status }))
      }
      if (input.action === 'events') {
        return Promise.resolve(
          new Response(
            'id: opaque-replay-2\nevent: snapshot\ndata: {"status":"Completed","text":"Saved answer"}\n\n',
            {
              headers: {
                'content-type': 'text/event-stream',
                'cache-control': 'no-store'
              }
            }
          )
        )
      }
      if (input.action === 'send' || input.action === 'retry') {
        return Promise.resolve(Response.json(accepted, { status: 202 }))
      }
      if (input.action === 'stop') {
        return Promise.resolve(Response.json({ ...attempt, status: 'Stopped' }))
      }
      if (input.action === 'history') {
        return Promise.resolve(
          Response.json({
            items: [
              {
                question: accepted.question,
                attempts: [{ ...attempt, text: 'Saved answer' }]
              }
            ],
            nextCursor: null,
            policyRevision: 0
          })
        )
      }
      return Promise.resolve(
        Response.json({
          id: input.address.id,
          workspaceId: input.address.workspaceId,
          createdAt: '2026-09-15T12:00:00Z',
          title: 'Explain',
          activeAttempt: attempt,
          policyRevision: 0
        })
      )
    }
  }
  const authority = SeedAssistantAuthority(resource, () => Effect.sync(() => state))
  const dependencies = Layer.mergeAll(
    AssistantConversationsLayer(transport).pipe(
      Layer.provide([SeedAssistantDirectory, authority])
    ),
    authority,
    Layer.succeed(RateLimiter, { take: () => Effect.succeed(true) }),
    Layer.succeed(
      AssistantOAuthTokenVerifier,
      makeAssistantOAuthTokenVerifier(
        { issuer, audience: resource },
        createLocalJWKSet({ keys: [{ ...jwk, kid: 'rest-key', alg: 'EdDSA' }] })
      )
    )
  )
  const platform = Layer.mergeAll(
    Path.layer,
    Etag.layer,
    FileSystem.layerNoop({}),
    HttpPlatform.layer.pipe(Layer.provide(FileSystem.layerNoop({})))
  )
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        HttpApiBuilder.layer(api).pipe(
          Layer.provide(assistantConversationsGroup({})),
          Layer.provide(assistantBearerAuth({})),
          HttpRouter.provideRequest(dependencies),
          Layer.provide(dependencies),
          Layer.provide(platform),
          Layer.provide(WideEventLoggerLive)
        ),
        { disableLogger: true }
      )
    ),
    (active) => Effect.promise(active.dispose)
  )
  function token(options: { scope?: string; audience?: string; userId?: string } = {}) {
    return Effect.promise(() =>
      new SignJWT({
        sub: options.userId ?? 'usr_rest',
        client_id: 'rest-client',
        scope: options.scope ?? 'assistant:read assistant:write',
        starter_workspace_id: 'wrk_rest',
        starter_session_id: 'ses_rest',
        starter_consent_binding: 'consent_rest:0'
      })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'rest-key' })
        .setIssuer(issuer)
        .setAudience(options.audience ?? resource)
        .setExpirationTime(expiresAt / 1000)
        .sign(keys.privateKey)
    )
  }
  function request(
    bearer: string,
    method: string,
    path: string,
    body?: Schema.Json,
    headers: Record<string, string> = {}
  ) {
    const options: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        ...headers
      }
    }
    if (body !== undefined) {
      options.body = encodeJson(body)
    }
    return Effect.promise(() =>
      server.handler(new Request(`https://api.test${path}`, options))
    )
  }
  return {
    token,
    request,
    calls,
    refuse: (value: { status: number; body: Schema.Json }) => {
      refusal = value
    },
    revoke: () => {
      state = null
    }
  }
})

describe('private assistant REST', () => {
  it.effect(
    'uses the same saved conversation for sends, Retry, Stop, history and SSE catch-up',
    () =>
      Effect.gen(function* () {
        const client = yield* fixture()
        const token = yield* client.token()
        const created = yield* client.request(
          token,
          'POST',
          '/assistant/conversations',
          { workspaceSlug: 'rest-lab' }
        )
        expect(created.status).toBe(201)
        const conversation = yield* jsonBody(created, ConversationSummary)
        const path = `/assistant/conversations/${conversation.id}`
        const sent = yield* client.request(token, 'POST', `${path}/messages`, {
          question: 'Explain',
          idempotencyKey: 'send-1'
        })
        expect(sent.status).toBe(202)
        expect((yield* jsonBody(sent, ConversationAcceptance)).attempt.id).toBe(
          'attempt-1'
        )
        expect(
          (yield* client.request(token, 'POST', `${path}/attempts/attempt-1/retry`, {
            idempotencyKey: 'retry-1'
          })).status
        ).toBe(202)
        expect(
          (yield* client.request(token, 'POST', `${path}/attempts/attempt-1/stop`))
            .status
        ).toBe(200)
        expect((yield* client.request(token, 'GET', `${path}/messages`)).status).toBe(
          200
        )
        const observed = yield* client.request(
          token,
          'GET',
          `${path}/attempts/attempt-1/events`,
          undefined,
          { 'last-event-id': 'expired-cursor' }
        )
        expect(observed.headers.get('content-type')).toContain('text/event-stream')
        expect(yield* Effect.promise(() => observed.text())).toContain('Saved answer')
        expect(client.calls.find((call) => call.action === 'events')?.lastEventId).toBe(
          'expired-cursor'
        )
        expect(client.calls.filter((call) => call.action === 'send')).toHaveLength(1)
        const listed = yield* jsonBody(
          yield* client.request(
            token,
            'GET',
            '/assistant/conversations?workspaceSlug=rest-lab'
          ),
          ConversationList
        )
        expect(listed.items.map((item) => item.id)).toEqual([conversation.id])
        expect((yield* client.request(token, 'DELETE', path)).status).toBe(202)
        expect((yield* client.request(token, 'GET', path)).status).toBe(404)
      })
  )

  it.effect(
    'rejects wrong audiences, foreign identities, missing write scope and revoked membership',
    () =>
      Effect.gen(function* () {
        const client = yield* fixture()
        const token = yield* client.token()
        const created = yield* jsonBody(
          yield* client.request(token, 'POST', '/assistant/conversations', {
            workspaceSlug: 'rest-lab'
          }),
          ConversationSummary
        )
        const path = `/assistant/conversations/${created.id}`
        expect(
          (yield* client.request(
            yield* client.token({ audience: 'https://api.test/mcp' }),
            'GET',
            path
          )).status
        ).toBe(401)
        expect((yield* client.request('workspace-api-token', 'GET', path)).status).toBe(
          401
        )
        expect(
          (yield* client.request(
            yield* client.token({ userId: 'another-member' }),
            'GET',
            path
          )).status
        ).toBe(404)
        expect(
          (yield* client.request(
            yield* client.token({ scope: 'assistant:read' }),
            'POST',
            `${path}/messages`,
            { question: 'Explain', idempotencyKey: 'denied' }
          )).status
        ).toBe(403)
        expect(
          (yield* client.request(
            token,
            'GET',
            '/assistant/conversations?workspaceSlug=foreign-lab'
          )).status
        ).toBe(404)
        client.revoke()
        const denied = yield* client.request(token, 'GET', path)
        expect(denied.status).toBe(404)
        expect((yield* jsonBody(denied, errorBody))._tag).toBe('ConversationNotFound')
        expect(client.calls).toHaveLength(0)
      })
  )
})

it.effect(
  'preserves typed input, idempotency, admission and configuration refusals on REST',
  () =>
    Effect.gen(function* () {
      const client = yield* fixture()
      const token = yield* client.token()
      const created = yield* jsonBody(
        yield* client.request(token, 'POST', '/assistant/conversations', {
          workspaceSlug: 'rest-lab'
        }),
        ConversationSummary
      )
      for (const refusal of [
        {
          status: 400,
          body: {
            _tag: 'ConversationInputRejected',
            reason: 'current_context_budget'
          }
        },
        {
          status: 409,
          body: { _tag: 'ConversationConflict', reason: 'idempotency_key_reused' }
        },
        {
          status: 429,
          body: {
            _tag: 'AssistantAdmissionRefused',
            reason: 'concurrency_limit',
            retryAfterSeconds: 30
          }
        },
        {
          status: 503,
          body: { _tag: 'ConversationUnavailable', reason: 'configuration' }
        }
      ]) {
        client.refuse(refusal)
        const response = yield* client.request(
          token,
          'POST',
          `/assistant/conversations/${created.id}/messages`,
          { question: 'Explain', idempotencyKey: 'send-1' }
        )
        expect(response.status).toBe(refusal.status)
        expect((yield* jsonBody(response, errorBody))._tag).toBe(refusal.body._tag)
      }
    })
)
