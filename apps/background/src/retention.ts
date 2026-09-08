import {
  Retention,
  type RetentionPolicyError
} from '@b2b-saas-starter/capabilities/governance/retention'
import {
  retentionPolicyFromEnv,
  validateRetentionPolicyTarget
} from '@b2b-saas-starter/capabilities/governance/retention-policy'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { withTriggerScope } from '@b2b-saas-starter/logger'
import {
  captureMonitoringSignal,
  captureOperationalSnapshot
} from '@b2b-saas-starter/logger/providers'
import { hasValue } from '@b2b-saas-starter/env/server'
import { DateTime, Effect, Metric, Result } from 'effect'
import { type Env } from './queue-consumer.ts'

export const retentionRunCount = Metric.counter('starter.retention.runs', {
  description: 'Retention runs by terminal outcome.',
  incremental: true
})
export const retentionBacklog = Metric.gauge('starter.retention.backlog', {
  description: 'Retention rules with remaining eligible or unchecked pages.'
})
export const retentionLastSuccess = Metric.gauge(
  'starter.retention.last_success_unix_ms',
  {
    description: 'Unix milliseconds of the last successful retention run.'
  }
)

function captureRetentionFailure(
  env: Env,
  target: string | undefined,
  error: RetentionPolicyError | CapabilityUnavailable
) {
  if (!hasValue(env.SENTRY_DSN)) {
    return Effect.void
  }
  return Effect.promise(() =>
    captureMonitoringSignal('retention_run_failed', {
      target: target ?? 'missing',
      reason: error.reason
    })
  )
}

function captureRetentionSnapshot(
  env: Env,
  backlog: number,
  lastSuccess: number | undefined
) {
  if (!hasValue(env.SENTRY_DSN)) {
    return Effect.void
  }
  if (lastSuccess !== undefined) {
    return Effect.promise(() =>
      captureOperationalSnapshot({
        'retention.backlog': backlog,
        'retention.last_success_unix_ms': lastSuccess
      })
    )
  }
  return Effect.promise(() =>
    captureOperationalSnapshot({ 'retention.backlog': backlog })
  )
}

/** Hourly retention is preview-only until recovery verification is explicitly
 * enabled. The returned aggregate is safe to expose to operators: it contains
 * counts and cutoffs, never row payloads or recipient identifiers. */
export function cleanRetention(env: Env, scheduledTime: number) {
  return withTriggerScope(
    {
      service: 'background',
      event: 'retention_cleanup',
      env,
      metadata: { scheduledTime }
    },
    Effect.gen(function* () {
      const databaseTarget = env.RETENTION_DATABASE_TARGET?.trim()
      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const retention = yield* Retention
          const configuredPolicy = yield* retentionPolicyFromEnv(env)
          yield* validateRetentionPolicyTarget(configuredPolicy, databaseTarget)
          let policy = configuredPolicy
          if (!configuredPolicy.destructiveEnabled && databaseTarget !== undefined) {
            policy = { ...configuredPolicy, target: databaseTarget }
          }
          let mode: 'preview' | 'execute' = 'preview'
          if (policy.destructiveEnabled) {
            mode = 'execute'
          }
          return yield* retention.run({
            mode,
            policy,
            now: DateTime.toDateUtc(DateTime.makeUnsafe(scheduledTime))
          })
        })
      )
      if (Result.isFailure(attempt)) {
        yield* captureRetentionFailure(env, databaseTarget, attempt.failure)
        yield* Metric.update(
          Metric.withAttributes(retentionRunCount, { status: 'failed' }),
          1
        )
        return yield* Effect.fail(attempt.failure)
      }
      const result = attempt.success
      yield* Effect.annotateLogsScoped({
        mode: result.mode,
        status: result.status,
        target: databaseTarget,
        candidates: result.candidates,
        deleted: result.deleted,
        failed: result.failed,
        backlog: result.backlog
      })
      yield* Metric.update(
        Metric.withAttributes(retentionRunCount, { status: result.status }),
        1
      )
      yield* Metric.update(retentionBacklog, result.backlog)
      let lastSuccess: number | undefined
      if (result.status === 'success') {
        lastSuccess = scheduledTime
      }
      yield* captureRetentionSnapshot(env, result.backlog, lastSuccess)
      if (result.status === 'success') {
        yield* Metric.update(retentionLastSuccess, scheduledTime)
      }
      if (result.status === 'failed') {
        const failure = new CapabilityUnavailable({
          capability: 'retention',
          reason: 'retention_rule_query_failed'
        })
        yield* captureRetentionFailure(env, databaseTarget, failure)
        return yield* Effect.fail(failure)
      }
    }).pipe(Effect.provide(selectCapabilitiesLayer(starterEnv(env))))
  )
}
