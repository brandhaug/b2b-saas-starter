import { describe, expect, it } from '@effect/vitest'
import { vi } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { HttpServerResponse } from 'effect/http'
import type * as Http from 'effect/http'
import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { buildWebHandler } from './http.ts'

// ESM exports are immutable; retain the real HTTP module behind a replaceable serializer for fault injection.
vi.mock('effect/http', (importOriginal) =>
  importOriginal<typeof Http>().then((actual) => ({
    ...actual,
    HttpServerResponse: {
      ...actual.HttpServerResponse,
      jsonUnsafe: vi.fn(actual.HttpServerResponse.jsonUnsafe)
    }
  }))
)

const decodeEvent = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      message: Schema.String,
      annotations: Schema.JsonObject
    })
  )
)

// Failure modes: handler scopes miss encoded status and gates; nested scopes
// duplicate completions; returned 503 looks successful; paths or credentials leak.
describe('API canonical HTTP logging', () => {
  it.live('keeps a defect findable after translating it to an opaque HTTP 500', () =>
    Effect.gen(function* () {
      const info = vi.spyOn(console, 'log').mockImplementation(() => {})
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const runtime = buildWebHandler({ ENVIRONMENT: 'test' })
      const responseFactory = vi
        .spyOn(HttpServerResponse, 'jsonUnsafe')
        .mockImplementationOnce(() => {
          throw new TypeError('private-provider-payload')
        })
      try {
        const response = yield* Effect.promise(() =>
          runtime.handler(new Request('https://api.test/'))
        )
        expect(response.status).toBe(500)
        expect(info).not.toHaveBeenCalled()
        expect(error).toHaveBeenCalledTimes(1)
        const line = error.mock.calls[0]?.[0]
        expect(decodeEvent(line).annotations).toMatchObject({
          statusCode: 500,
          status: 'error',
          errorKind: 'defect',
          errorSummary: expect.stringContaining('TypeError')
        })
        expect(line).not.toContain('private-provider-payload')
      } finally {
        yield* Effect.promise(() => runtime.dispose())
        responseFactory.mockRestore()
        info.mockRestore()
        error.mockRestore()
      }
    })
  )

  for (const { path, status, operation, authenticated } of [
    { path: '/health', status: 200, operation: 'request.health', authenticated: false },
    {
      path: '/workspaces/customer-private/overview',
      status: 401,
      operation: 'request.workspace.overview',
      authenticated: false
    },
    {
      path: '/unknown-customer-private?secret=customer-secret',
      status: 404,
      operation: undefined,
      authenticated: false
    },
    { path: '/ready', status: 503, operation: undefined, authenticated: false },
    { path: '/', status: 200, operation: undefined, authenticated: false },
    {
      path: '/.well-known/oauth-protected-resource',
      status: 404,
      operation: undefined,
      authenticated: false
    },
    {
      path: '/workspaces/starter-lab/overview',
      status: 200,
      operation: 'request.workspace.overview',
      authenticated: true
    }
  ]) {
    it.live(`records one sanitized completion for ${path}`, () =>
      Effect.gen(function* () {
        const info = vi.spyOn(console, 'log').mockImplementation(() => {})
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const runtime = buildWebHandler({ ENVIRONMENT: 'test' })
        try {
          const headers = new Headers()
          if (authenticated) {
            headers.set('authorization', `Bearer ${SEED_API_TOKEN}`)
          }
          const response = yield* Effect.promise(() =>
            runtime.handler(new Request(`https://api.test${path}`, { headers }))
          )
          expect(response.status).toBe(status)
          const calls = [...info.mock.calls, ...error.mock.calls]
          expect(calls).toHaveLength(1)
          const line = calls[0]?.[0]
          const decoded = decodeEvent(line)
          expect(decoded.message).toBe('api.request')
          const event = decoded.annotations
          let canonicalStatus = 'ok'
          let errorCount = 0
          if (status >= 500) {
            canonicalStatus = 'error'
            errorCount = 1
          }
          expect(event).toMatchObject({
            service: 'api',
            statusCode: status,
            status: canonicalStatus
          })
          if (operation !== undefined) {
            expect(event.operation).toBe(operation)
          }
          if (
            path === '/ready' ||
            path === '/' ||
            path === '/.well-known/oauth-protected-resource'
          ) {
            expect(event.routeTemplate).toBe(path)
          }
          if (status === 401) {
            expect(event.outcome).toBe('missing_bearer_token')
          }
          if (authenticated) {
            expect(event.workspaceId).toBeDefined()
            expect(event.tokenId).toBeDefined()
          }
          expect(error.mock.calls).toHaveLength(errorCount)
          expect(line).not.toContain('customer-private')
          expect(line).not.toContain('customer-secret')
          expect(line).not.toContain(SEED_API_TOKEN)
          expect(event).not.toHaveProperty('pathname')
          expect(event).not.toHaveProperty('workspaceSlug')
          expect(event).not.toHaveProperty('tokenWorkspaceSlug')
        } finally {
          yield* Effect.promise(() => runtime.dispose())
          info.mockRestore()
          error.mockRestore()
        }
      })
    )
  }
})
