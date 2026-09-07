import { RawD1, type D1Binding } from '@b2b-saas-starter/db/service'
import { Clock, DateTime, Effect, Layer, Result } from 'effect'

import { CapabilityUnavailable } from '../errors.ts'
import {
  emptyCounts,
  Retention,
  RetentionPolicyError,
  type RetentionResult,
  type RetentionRuleResult,
  type RetentionRunInput
} from './retention.ts'
import { retentionPolicyDigest, validateRetentionPolicy } from './retention-policy.ts'
import { retentionRules, type RetentionRule } from './retention-rules.ts'

type Candidate = { id: string; clock: string | number; eligible: number }
type Progress = {
  record_class: string
  policy_digest: string
  cursor_clock: string | null
  cursor_id: string | null
  last_success_at: string | null
}

function unavailable() {
  return new CapabilityUnavailable({
    capability: 'retention',
    reason: 'retention_database_unavailable'
  })
}

function query<A>(read: () => Promise<A>) {
  return Effect.tryPromise({ try: read, catch: unavailable })
}

function progressStatement(
  d1: D1Binding,
  input: {
    readonly rule: RetentionRule
    readonly digest: string
    readonly evaluatedAt: string
    readonly cursor: Candidate | undefined
    readonly lastSuccessAt: string | null
    readonly hasMore: boolean
    readonly failure: string | null
  }
) {
  let cursorClock: string | null = null
  if (input.cursor !== undefined) {
    cursorClock = String(input.cursor.clock)
  }
  let backlog = 0
  if (input.hasMore) {
    backlog = 1
  }
  return d1
    .prepare(`INSERT INTO retention_progress
    (record_class, policy_digest, cursor_clock, cursor_id, last_success_at, last_evaluated_at, has_more, failure)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(record_class) DO UPDATE SET
      policy_digest = excluded.policy_digest, cursor_clock = excluded.cursor_clock,
      cursor_id = excluded.cursor_id, last_success_at = excluded.last_success_at,
      last_evaluated_at = excluded.last_evaluated_at, has_more = excluded.has_more, failure = excluded.failure`)
    .bind(
      input.rule.key,
      input.digest,
      cursorClock,
      input.cursor?.id ?? null,
      input.lastSuccessAt,
      input.evaluatedAt,
      backlog,
      input.failure
    )
}

/** The mutation rechecks expiry and status after selection. Its cursor commits
 * in the same D1 batch, so a crash cannot advance past an uncommitted delete. */
function sweep(
  d1: D1Binding,
  input: {
    readonly rule: RetentionRule
    readonly limit: number
    readonly execute: boolean
    readonly digest: string
    readonly evaluatedAt: string
    readonly progress: Progress | undefined
  }
) {
  return Effect.gen(function* () {
    const { rule, progress } = input
    let cursor: Progress | undefined
    if (input.execute && progress?.policy_digest === input.digest) {
      cursor = progress
    }
    const params: Array<string | number> = [rule.cutoff]
    let after = ''
    if (
      cursor?.cursor_clock !== null &&
      cursor?.cursor_clock !== undefined &&
      cursor.cursor_id !== null
    ) {
      after = ` AND ((${rule.clock}), id) > (?, ?)`
      let clock: string | number = cursor.cursor_clock
      if (rule.clockType === 'epoch') {
        clock = Number(clock)
      }
      params.push(clock, cursor.cursor_id)
    }
    params.push(input.limit)
    const selected = yield* query(() =>
      d1
        .prepare(
          `SELECT id, (${rule.clock}) AS clock, CASE WHEN (${rule.eligible}) THEN 1 ELSE 0 END AS eligible
       FROM ${rule.table} INDEXED BY ${rule.index}
       WHERE (${rule.clock}) IS NOT NULL AND (${rule.clock}) <= ?${after}
       ORDER BY (${rule.clock}), id LIMIT ?`
        )
        .bind(...params)
        .all<Candidate>()
    )
    const rows = selected.results
    const candidates = rows.filter((row) => row.eligible === 1)
    // A full page means there may be more work. The next empty/short page
    // confirms completion and resets the cursor for newly eligible old rows.
    const hasMore = rows.length === input.limit
    let deleted = 0
    let lastSuccessAt = progress?.last_success_at ?? null
    if (input.execute) {
      let next: Candidate | undefined
      if (hasMore) {
        next = rows.at(-1)
      }
      const checkpoint = progressStatement(d1, {
        rule,
        digest: input.digest,
        evaluatedAt: input.evaluatedAt,
        cursor: next,
        lastSuccessAt: input.evaluatedAt,
        hasMore,
        failure: null
      })
      if (candidates.length === 0) {
        yield* query(() => checkpoint.run())
      } else {
        const ids = candidates.map((row) => row.id)
        const placeholders = ids.map(() => '?').join(', ')
        let operation = `DELETE FROM ${rule.table}`
        if (rule.update !== undefined) {
          operation = `UPDATE ${rule.table} SET ${rule.update}`
        }
        const mutation = d1
          .prepare(
            `${operation} WHERE id IN (${placeholders}) AND (${rule.clock}) <= ? AND (${rule.eligible}) RETURNING id`
          )
          .bind(...ids, rule.cutoff)
        const result = yield* query(() =>
          d1.batch<{ id: string }>([mutation, checkpoint])
        )
        deleted = result[0]?.results.length ?? 0
      }
      lastSuccessAt = input.evaluatedAt
    }
    return {
      recordClass: rule.key,
      cutoff: rule.cutoffIso,
      scanned: rows.length,
      candidates: candidates.length,
      deleted,
      hasMore,
      lastSuccessAt,
      failure: null
    } satisfies RetentionRuleResult
  })
}

function recoveryCandidates(d1: D1Binding, now: number) {
  return Effect.gen(function* () {
    const exportCutoff = DateTime.formatIso(DateTime.makeUnsafe(now - 3_600_000))
    const webhookCutoff = DateTime.formatIso(DateTime.makeUnsafe(now - 86_400_000))
    const exports = yield* query(() =>
      d1
        .prepare(
          `SELECT id FROM workspace_exports INDEXED BY workspace_exports_recovery_idx
       WHERE status = 'pending' AND created_at <= ? ORDER BY created_at, id LIMIT 101`
        )
        .bind(exportCutoff)
        .all<{ id: string }>()
    )
    let webhooks = 0
    let webhookCapped = false
    for (const status of ['pending', 'failed']) {
      const rows = yield* query(() =>
        d1
          .prepare(
            `SELECT id FROM webhook_deliveries INDEXED BY webhook_deliveries_recovery_idx
         WHERE status = ? AND last_attempt_at <= ? ORDER BY last_attempt_at, id LIMIT 51`
          )
          .bind(status, webhookCutoff)
          .all<{ id: string }>()
      )
      webhooks += rows.results.length
      webhookCapped ||= rows.results.length === 51
    }
    return {
      exports: exports.results.length,
      webhooks,
      capped: exports.results.length === 101 || webhookCapped
    }
  })
}

export const LiveRetention = Layer.effect(
  Retention,
  Effect.gen(function* () {
    const d1 = yield* RawD1
    const run = Effect.fn('Retention.run')(function* (input: RetentionRunInput) {
      yield* validateRetentionPolicy(input.policy)
      let now = yield* Clock.currentTimeMillis
      if (input.now !== undefined) {
        now = input.now.getTime()
      }
      if (!Number.isFinite(now)) {
        return yield* Effect.fail(
          new RetentionPolicyError({ reason: 'retention_clock_invalid' })
        )
      }
      const evaluatedAt = DateTime.formatIso(DateTime.makeUnsafe(now))
      const digest = retentionPolicyDigest(input.policy)
      const execute = input.mode === 'execute' && input.policy.destructiveEnabled
      const rules = retentionRules(input.policy, now)
      const limit = Math.min(
        input.policy.batchSize,
        Math.floor(input.policy.workBudget / rules.length)
      )
      if (limit < 1) {
        return yield* Effect.fail(
          new RetentionPolicyError({ reason: 'retention_work_budget_too_small' })
        )
      }
      const saved = yield* query(() =>
        d1
          .prepare(
            'SELECT record_class, policy_digest, cursor_clock, cursor_id, last_success_at FROM retention_progress'
          )
          .all<Progress>()
      )
      const progress = new Map(saved.results.map((row) => [row.record_class, row]))
      const records: Array<RetentionRuleResult> = []
      const candidates = { ...emptyCounts() }
      const deleted = { ...emptyCounts() }
      const cutoffs: Record<string, string> = {}
      for (const rule of rules) {
        const result = yield* sweep(d1, {
          rule,
          limit,
          execute,
          digest,
          evaluatedAt,
          progress: progress.get(rule.key)
        }).pipe(Effect.result)
        if (Result.isSuccess(result)) {
          records.push(result.success)
          candidates[rule.key] = result.success.candidates
          deleted[rule.key] = result.success.deleted
        } else {
          if (execute) {
            // Preserve the last committed cursor and success time on failure.
            // If bookkeeping also fails, the returned failed outcome still alerts.
            yield* query(() =>
              d1
                .prepare(
                  `INSERT INTO retention_progress (record_class, policy_digest, last_evaluated_at, has_more, failure)
             VALUES (?, ?, ?, 1, 'database_unavailable')
             ON CONFLICT(record_class) DO UPDATE SET last_evaluated_at = excluded.last_evaluated_at,
               has_more = 1, failure = 'database_unavailable'`
                )
                .bind(rule.key, digest, evaluatedAt)
                .run()
            ).pipe(Effect.catch(() => Effect.void))
          }
          records.push({
            recordClass: rule.key,
            cutoff: rule.cutoffIso,
            scanned: 0,
            candidates: 0,
            deleted: 0,
            hasMore: true,
            lastSuccessAt: progress.get(rule.key)?.last_success_at ?? null,
            failure: 'database_unavailable'
          })
        }
        cutoffs[rule.key] = rule.cutoffIso
      }
      const failed = records.filter((record) => record.failure !== null).length
      const recovery = yield* recoveryCandidates(d1, now)
      let status: RetentionResult['status'] = 'success'
      if (input.mode === 'execute' && !execute) {
        status = 'disabled'
      }
      if (failed > 0) {
        status = 'failed'
      }
      return {
        mode: input.mode,
        evaluatedAt,
        policyDigest: digest,
        cutoffs,
        candidates,
        deleted,
        failed,
        backlog: records.filter((record) => record.hasMore).length,
        status,
        records,
        recovery
      } satisfies RetentionResult
    })
    return Retention.of({ run })
  })
)
