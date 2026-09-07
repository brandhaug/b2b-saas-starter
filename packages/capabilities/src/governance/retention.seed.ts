import { DateTime, Effect, Layer } from 'effect'

import {
  emptyCounts,
  Retention,
  type RetentionResult,
  type RetentionRunInput
} from './retention.ts'
import { retentionPolicyDigest, validateRetentionPolicy } from './retention-policy.ts'

export const SeedRetention = Layer.succeed(Retention, {
  run: Effect.fn('Retention.run')(function* (input: RetentionRunInput) {
    yield* validateRetentionPolicy(input.policy)
    const evaluatedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso))
    return {
      mode: input.mode,
      evaluatedAt: input.now?.toISOString() ?? evaluatedAt,
      policyDigest: retentionPolicyDigest(input.policy),
      cutoffs: {},
      candidates: emptyCounts(),
      deleted: emptyCounts(),
      failed: 0,
      backlog: 0,
      status: 'inactive',
      records: [],
      recovery: { exports: 0, webhooks: 0, capped: false }
    } satisfies RetentionResult
  })
})
