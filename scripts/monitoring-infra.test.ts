import assert from 'node:assert/strict'
import { test } from 'vite-plus/test'
import * as Effect from 'effect/Effect'
import { checkMonitoringPolicyOwnership } from '../infra/monitoring-ownership.ts'
import {
  validateMonitoring,
  monitoringQueueTargets,
  type MonitoringConfig
} from '../infra/monitoring-settings.ts'

function configured(): MonitoringConfig {
  return {
    enabled: true,
    accountId: 'a'.repeat(32),
    stage: 'prod',
    activate: false,
    destinations: { webhooks: [{ id: 'authorized-destination' }] },
    sqlAlerts: [
      {
        key: 'snapshot-freshness',
        service: 'background',
        query: 'SELECT verified_value AS value FROM verified.dataset',
        trigger: { type: 'threshold', operator: '>', value: 0, window: '2m' },
        every: '1m',
        verification: {
          record: 'private:monitoring/snapshot',
          dataset: 'verified.dataset',
          missingData: 'independent-watchdog',
          watchdog: 'private:watchdog/snapshot',
          recovery: 'Fresh valid snapshot with zero overdue work'
        }
      }
    ]
  }
}

test('disabled monitoring needs no account, destinations or credentials', () => {
  assert.doesNotThrow(() => validateMonitoring({ enabled: false }))
})

test('monitoring rejects non-production ownership before provisioning', () => {
  const config = configured()
  if (!config.enabled) {
    throw new Error('Expected enabled fixture')
  }
  assert.throws(() => validateMonitoring({ ...config, stage: 'staging' }), /prod/)
})

const policy = {
  id: 'existing',
  name: 'b2b-saas-starter/prod/background/freshness',
  alertType: 'custom_analytics'
} as const
const desiredPolicy = {
  logicalId: 'sql-background-freshness',
  name: policy.name,
  resourceType: 'Cloudflare.Alerting.CustomAlert',
  alertType: 'custom_analytics'
}
const savedPolicy = {
  resourceType: desiredPolicy.resourceType,
  attr: { policyId: policy.id, accountId: 'a'.repeat(32) }
}

test('cold same-name policy collision fails instead of silently adopting', async () => {
  await assert.rejects(
    Effect.runPromise(
      checkMonitoringPolicyOwnership('a'.repeat(32), [desiredPolicy], {
        list: Effect.succeed([policy]),
        saved: () => Effect.succeed(undefined)
      })
    ),
    /unowned/
  )
})

test('saved ownership and exact explicit adoption permit the intended policy', async () => {
  await assert.doesNotReject(
    Effect.runPromise(
      checkMonitoringPolicyOwnership('a'.repeat(32), [desiredPolicy], {
        list: Effect.succeed([policy]),
        saved: () => Effect.succeed(savedPolicy)
      })
    )
  )
  await assert.doesNotReject(
    Effect.runPromise(
      checkMonitoringPolicyOwnership(
        'a'.repeat(32),
        [{ ...desiredPolicy, adoptPolicyId: policy.id }],
        {
          list: Effect.succeed([policy]),
          saved: () => Effect.succeed(undefined)
        }
      )
    )
  )
})

test('duplicates fail even when one matching ID is saved', async () => {
  await assert.rejects(
    Effect.runPromise(
      checkMonitoringPolicyOwnership('a'.repeat(32), [desiredPolicy], {
        list: Effect.succeed([policy, { ...policy, id: 'duplicate' }]),
        saved: () => Effect.succeed(savedPolicy)
      })
    ),
    /duplicate/
  )
})

test('permission failure is propagated rather than interpreted as no existing policy', async () => {
  const denied = new Error('Forbidden policy inventory')
  await assert.rejects(
    Effect.runPromise(
      checkMonitoringPolicyOwnership('a'.repeat(32), [desiredPolicy], {
        list: Effect.fail(denied),
        saved: () => Effect.succeed(undefined)
      })
    ),
    /Forbidden policy inventory/
  )
})

test('wrong-account state and mismatched explicit adoption IDs fail closed', async () => {
  await assert.rejects(
    Effect.runPromise(
      checkMonitoringPolicyOwnership('a'.repeat(32), [desiredPolicy], {
        list: Effect.succeed([policy]),
        saved: () =>
          Effect.succeed({
            ...savedPolicy,
            attr: { ...savedPolicy.attr, accountId: 'b'.repeat(32) }
          })
      })
    ),
    /account/
  )
  await assert.rejects(
    Effect.runPromise(
      checkMonitoringPolicyOwnership(
        'a'.repeat(32),
        [{ ...desiredPolicy, adoptPolicyId: 'other' }],
        {
          list: Effect.succeed([policy]),
          saved: () => Effect.succeed(undefined)
        }
      )
    ),
    /adoption/
  )
})

test('an empty inventory permits creation but cannot satisfy explicit adoption', async () => {
  await Effect.runPromise(
    checkMonitoringPolicyOwnership('a'.repeat(32), [desiredPolicy], {
      list: Effect.succeed([]),
      saved: () => Effect.succeed(undefined)
    })
  )
  await assert.rejects(
    Effect.runPromise(
      checkMonitoringPolicyOwnership(
        'a'.repeat(32),
        [{ ...desiredPolicy, adoptPolicyId: policy.id }],
        {
          list: Effect.succeed([]),
          saved: () => Effect.succeed(undefined)
        }
      )
    ),
    /adoption/
  )
})

test('queue monitoring includes the export queue only when that optional feature is deployed', () => {
  const queues = {
    webhookQueue: '1'.repeat(32),
    webhookDeadLetterQueue: '2'.repeat(32),
    billingQueue: '3'.repeat(32),
    billingDeadLetterQueue: '4'.repeat(32),
    notificationEmailQueue: '5'.repeat(32),
    emailEventsQueue: '6'.repeat(32)
  }
  assert.equal(monitoringQueueTargets('prod', queues).length, 6)
  assert.equal(
    monitoringQueueTargets('prod', { ...queues, workspaceExportQueue: '7'.repeat(32) })
      .length,
    7
  )
})

test('prepared rules can remain disabled with explicit verified query evidence', () => {
  assert.doesNotThrow(() => validateMonitoring(configured()))
})

test('missing destinations and duplicate logical rule IDs fail before provisioning', () => {
  const config = configured()
  if (!config.enabled) {
    throw new Error('Expected enabled fixture')
  }
  assert.throws(
    () => validateMonitoring({ ...config, destinations: {} }),
    /destination/
  )
  assert.throws(
    () =>
      validateMonitoring({
        ...config,
        sqlAlerts: [...config.sqlAlerts, ...config.sqlAlerts]
      }),
    /unique/
  )
})

test('no-data coverage cannot be claimed without an independent watchdog reference', () => {
  const config = configured()
  if (!config.enabled) {
    throw new Error('Expected enabled fixture')
  }
  const sqlAlerts = config.sqlAlerts.map((rule) => ({
    ...rule,
    verification: { ...rule.verification, watchdog: '' }
  }))
  assert.throws(() => validateMonitoring({ ...config, sqlAlerts }), /watchdog/)
})

test('invalid SQL shape and unsupported recurrence bounds fail locally', () => {
  const config = configured()
  if (!config.enabled) {
    throw new Error('Expected enabled fixture')
  }
  assert.throws(
    () =>
      validateMonitoring({
        ...config,
        sqlAlerts: config.sqlAlerts.map((rule) => ({
          ...rule,
          query: `${rule.query};`
        }))
      }),
    /semicolon/
  )
  assert.throws(
    () =>
      validateMonitoring({
        ...config,
        issues: { afterOccurrences: 1, afterInactivitySeconds: 60 }
      }),
    /inactivity/
  )
})
