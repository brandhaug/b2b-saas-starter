/* oxlint-disable effect/noAsyncFunction -- Promise-returning fakes exercise the sink port */
// oxlint-disable-next-line effect/noNodeBuiltinImport -- loopback server verifies native fetch redirect behavior
import { createServer } from 'node:http'
import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { describe, expect, vi } from 'vite-plus/test'

import {
  makeHttpSecurityEvidenceSink,
  recordSecurityEvidence,
  revokeWithEvidence,
  type SecurityEvidenceInput,
  type SecurityEvidenceRecord
} from './security-recovery-evidence'

const input = {
  kind: 'api_token_revoked',
  subjectId: 'token-1'
} satisfies SecurityEvidenceInput

describe('security recovery evidence', () => {
  it.live('revokes before writing evidence and succeeds when the sink is healthy', () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const result = yield* revokeWithEvidence(
        Effect.sync(() => {
          order.push('revoke')
          return true
        }),
        input,
        {
          append: async () => {
            order.push('append')
          },
          reportGap: async () => {
            order.push('gap')
          }
        }
      )
      expect(result).toEqual({ revoked: true, evidence: 'recorded' })
      expect(order).toEqual(['revoke', 'append'])
    })
  )

  it.live('keeps urgent revocation successful when evidence persistence fails', () =>
    Effect.gen(function* () {
      const reportGap = vi.fn(async () => undefined)
      const result = yield* revokeWithEvidence(Effect.succeed(true), input, {
        append: async () => {
          throw new Error('independent store unavailable')
        },
        reportGap
      })
      expect(result).toEqual({ revoked: true, evidence: 'gap' })
      expect(reportGap).toHaveBeenCalledWith({
        evidenceId: expect.stringMatching(/^sec_/),
        kind: 'api_token_revoked',
        subjectId: 'token-1',
        workspaceId: null
      })
    })
  )

  it.live('does not create evidence when there was nothing to revoke', () =>
    Effect.gen(function* () {
      const append = vi.fn(async () => undefined)
      const result = yield* revokeWithEvidence(Effect.succeed(false), input, {
        append,
        reportGap: async () => undefined
      })
      expect(result).toEqual({ revoked: false, evidence: 'not_needed' })
      expect(append).not.toHaveBeenCalled()
    })
  )

  it.effect('does not follow a redirect from the evidence sink', () => {
    let successfulAppends = 0
    let redirectedRequests = 0
    const server = createServer((request, response) => {
      if (request.url === '/success') {
        successfulAppends += 1
        response.writeHead(204).end()
        return
      }
      if (request.url === '/redirect') {
        response.writeHead(307, { location: '/target' }).end()
        return
      }
      if (request.url === '/target') {
        redirectedRequests += 1
        response.writeHead(204).end()
      }
    })
    return Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () =>
          new Promise<typeof server>((resolve, reject) => {
            server.once('error', reject)
            server.listen(0, '127.0.0.1', () => resolve(server))
          }),
        catch: () => new Error('test server failed to listen')
      }),
      (listeningServer) =>
        Effect.gen(function* () {
          const address = listeningServer.address()
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Node's address API returns a string for named pipes
          if (address === null || typeof address === 'string') {
            return yield* Effect.fail(new Error('test server did not expose a port'))
          }
          const record = {
            id: 'sec_test',
            kind: 'api_token_revoked',
            subjectId: 'token-1',
            workspaceId: null,
            occurredAt: '2026-01-01T00:00:00.000Z',
            source: 'live'
          } satisfies SecurityEvidenceRecord
          yield* Effect.promise(() =>
            makeHttpSecurityEvidenceSink({
              url: `http://127.0.0.1:${address.port}/success`,
              token: 'test-token',
              reportGap: async () => undefined
            }).append(record)
          )
          expect(successfulAppends).toBe(1)

          const gaps: Array<unknown> = []
          const outcome = yield* recordSecurityEvidence(
            input,
            makeHttpSecurityEvidenceSink({
              url: `http://127.0.0.1:${address.port}/redirect`,
              token: 'test-token',
              reportGap: async (gap) => {
                gaps.push(gap)
              }
            })
          )
          expect(outcome).toBe('gap')
          expect(redirectedRequests).toBe(0)
          expect(gaps).toHaveLength(1)
        }),
      (activeServer) =>
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              activeServer.close(() => {
                resolve()
              })
            })
        )
    )
  })
})
