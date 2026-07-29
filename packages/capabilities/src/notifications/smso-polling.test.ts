import { describe, expect, it } from 'vitest'
import { Effect, Redacted } from 'effect'
import { pollSmsoStatuses } from './smso-polling.ts'

describe('SMSO.ro status polling', () => {
  it('bounds trusted queries and emits stable idempotent lifecycle evidence', async () => {
    const requestedLimits: number[] = []
    const ingested: Record<string, unknown>[] = []
    const candidate = {
      attemptId: 'pat_polling',
      intentId: 'nti_polling',
      fingerprint: `sha256:${'a'.repeat(64)}`,
      ciphertext: 'protected-token',
      keyVersion: 1
    }
    const run = () =>
      Effect.runPromise(
        pollSmsoStatuses({
          limit: 1_000,
          environment: 'production',
          providerAccountKey: 'platform-smso',
          loadCandidates: (limit) => {
            requestedLimits.push(limit)
            return Effect.succeed([candidate])
          },
          revealReference: () =>
            Effect.succeed(Redacted.make('8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa')),
          query: (request) =>
            Effect.succeed({
              _tag: 'evidence' as const,
              evidence: {
                evidenceId: 'pevd_polling_delivered',
                attemptId: request.attemptId,
                intentId: request.intentId,
                provider: 'smso' as const,
                source: 'query' as const,
                status: 'delivered' as const,
                observedAt: '2026-07-29T12:00:00.000Z',
                providerReferenceFingerprint: request.providerReferenceFingerprint,
                trusted: true
              }
            }),
          ingestEvidence: (input) => {
            ingested.push(input)
            return Effect.void
          }
        })
      )

    await run()
    await run()

    expect(requestedLimits).toEqual([100, 100])
    expect(ingested).toHaveLength(2)
    expect(ingested[0]).toEqual(ingested[1])
    expect(ingested[0]).toMatchObject({
      source: 'query',
      sourceEventKey: `smso:query:${candidate.fingerprint}:delivered`,
      trusted: true
    })
  })

  it('does not ingest nonterminal, throttled, or failed queries as evidence', async () => {
    let ingested = 0
    const result = await Effect.runPromise(
      pollSmsoStatuses({
        environment: 'production',
        providerAccountKey: 'platform-smso',
        loadCandidates: () =>
          Effect.succeed([
            {
              attemptId: 'pat_pending',
              intentId: 'nti_pending',
              fingerprint: `sha256:${'b'.repeat(64)}`,
              ciphertext: 'protected-token',
              keyVersion: 1
            }
          ]),
        revealReference: () => Effect.succeed(Redacted.make('token')),
        query: () => Effect.succeed({ _tag: 'throttled', retryAfterSeconds: 30 }),
        ingestEvidence: () => {
          ingested += 1
          return Effect.void
        }
      })
    )
    expect(result).toEqual({ selected: 1, ingested: 0, deferred: 1 })
    expect(ingested).toBe(0)
  })
})
