import { Effect, Redacted } from 'effect'
import type {
  ProviderEvidence,
  ProviderQueryOutcome,
  ProviderQueryRequest
} from './provider-contracts.ts'

export type SmsoPollingCandidate = {
  readonly attemptId: string
  readonly intentId: string
  readonly fingerprint: string
  readonly ciphertext: string
  readonly keyVersion: number
}

type QueryRequest = typeof ProviderQueryRequest.Type
type QueryOutcome = typeof ProviderQueryOutcome.Type
type Evidence = typeof ProviderEvidence.Type

type IngestEvidence = {
  readonly id: string
  readonly intentId: string
  readonly attemptId: string
  readonly environment: string
  readonly providerAccountKey: string
  readonly source: 'query'
  readonly sourceEventKey: string
  readonly providerReferenceFingerprint: string
  readonly normalizedCode?: string
  readonly providerOccurredAt?: string
  readonly status: Evidence['status']
  readonly trusted: true
  readonly observedAt: string
}

export const pollSmsoStatuses = <
  LoadError,
  RevealError,
  QueryError,
  IngestError
>(options: {
  readonly limit?: number
  readonly environment: string
  readonly providerAccountKey: string
  readonly loadCandidates: (
    limit: number
  ) => Effect.Effect<readonly SmsoPollingCandidate[], LoadError>
  readonly revealReference: (
    candidate: SmsoPollingCandidate
  ) => Effect.Effect<Redacted.Redacted<string>, RevealError>
  readonly query: (request: QueryRequest) => Effect.Effect<QueryOutcome, QueryError>
  readonly ingestEvidence: (
    input: IngestEvidence
  ) => Effect.Effect<unknown, IngestError>
}) =>
  Effect.gen(function* () {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 100)
    const candidates = yield* options.loadCandidates(limit)
    const outcomes = yield* Effect.forEach(
      candidates.slice(0, limit),
      (candidate) =>
        Effect.gen(function* () {
          const revealed = yield* Effect.result(options.revealReference(candidate))
          if (revealed._tag === 'Failure') return false
          const queried = yield* Effect.result(
            options.query({
              provider: 'smso',
              attemptId: candidate.attemptId,
              intentId: candidate.intentId,
              providerReference: revealed.success,
              providerReferenceFingerprint: candidate.fingerprint
            })
          )
          if (queried._tag === 'Failure' || queried.success._tag !== 'evidence')
            return false
          const evidence = queried.success.evidence
          const ingested = yield* Effect.result(
            options.ingestEvidence({
              id: evidence.evidenceId,
              intentId: evidence.intentId,
              attemptId: evidence.attemptId,
              environment: options.environment,
              providerAccountKey: options.providerAccountKey,
              source: 'query',
              sourceEventKey: `smso:query:${candidate.fingerprint}:${evidence.status}`,
              providerReferenceFingerprint: candidate.fingerprint,
              ...(evidence.code ? { normalizedCode: evidence.code } : {}),
              ...(evidence.providerOccurredAt
                ? { providerOccurredAt: evidence.providerOccurredAt }
                : {}),
              status: evidence.status,
              trusted: true,
              observedAt: evidence.observedAt
            })
          )
          return ingested._tag === 'Success'
        }),
      { concurrency: 4 }
    )
    const ingested = outcomes.filter(Boolean).length
    return {
      selected: candidates.slice(0, limit).length,
      ingested,
      deferred: candidates.slice(0, limit).length - ingested
    }
  })
