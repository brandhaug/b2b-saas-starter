import * as Cloudflare from '@alchemy.run/cloudflare'
import * as GitHub from '@alchemy.run/github'
import * as Alchemy from 'alchemy'
import * as Output from 'alchemy/Output'
import { Stage } from 'alchemy/Stage'
import { localState } from 'alchemy/State/LocalState'
import * as Config from 'effect/Config'
import { SourceError } from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Redacted from 'effect/Redacted'
import monitoring from './monitoring.config.ts'
import { preflightMonitoringPolicies } from './infra/monitoring-ownership.ts'
import { stageResourceNames, type WorkerApp } from './infra/bindings.ts'
import {
  monitoringQueueTargets,
  validateMonitoring
} from './infra/monitoring-settings.ts'

const monitoringState = localState()

export default Alchemy.Stack(
  'b2b-saas-starter-monitoring',
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: monitoringState
  },
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => validateMonitoring(monitoring),
      catch: (cause) =>
        new Config.ConfigError(
          new SourceError({ message: 'Invalid monitoring configuration', cause })
        )
    })
    const stage = yield* Stage
    if (stage !== 'prod') {
      return yield* Effect.fail(
        new Config.ConfigError(
          new SourceError({
            message: 'Monitoring has one owner; use only the Alchemy --stage prod state'
          })
        )
      )
    }
    if (!monitoring.enabled) {
      return { enabled: false }
    }
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment
    if (accountId !== monitoring.accountId) {
      return yield* Effect.fail(
        new Config.ConfigError(
          new SourceError({
            message:
              'Monitoring account must match the authenticated Cloudflare account'
          })
        )
      )
    }
    const names = stageResourceNames(monitoring.stage)
    const prefix = `b2b-saas-starter/${monitoring.stage}`
    const desiredPolicies = monitoring.sqlAlerts.map((rule) => ({
      logicalId: `sql-${rule.service}-${rule.key}`,
      name: `${prefix}/${rule.service}/${rule.key}`,
      resourceType: 'Cloudflare.Alerting.CustomAlert',
      alertType: 'custom_analytics',
      adoptPolicyId: rule.adoptPolicyId
    }))
    if (monitoring.issues) {
      desiredPolicies.push({
        logicalId: 'worker-issues',
        name: `${prefix}/worker-issues`,
        resourceType: 'Cloudflare.Alerting.NotificationPolicy',
        alertType: 'workers_observability_real_time_issue',
        adoptPolicyId: monitoring.issues.adoptPolicyId
      })
    }
    yield* preflightMonitoringPolicies(accountId, desiredPolicies).pipe(
      Effect.provide(monitoringState),
      Effect.mapError(
        (cause) =>
          new Config.ConfigError(
            new SourceError({
              message: 'Monitoring policy ownership preflight failed',
              cause
            })
          )
      )
    )
    for (const rule of monitoring.sqlAlerts) {
      yield* Cloudflare.Alerting.CustomAlert(`sql-${rule.service}-${rule.key}`, {
        name: `${prefix}/${rule.service}/${rule.key}`,
        query: rule.query,
        trigger: rule.trigger,
        every: rule.every,
        mechanisms: monitoring.destinations,
        enabled: monitoring.activate
      })
    }
    if (monitoring.issues) {
      const policy = yield* Cloudflare.Alerting.NotificationPolicy('worker-issues', {
        name: `${prefix}/worker-issues`,
        alertType: 'workers_observability_real_time_issue',
        mechanisms: monitoring.destinations,
        enabled: monitoring.activate
      })
      const services: ReadonlyArray<WorkerApp> = ['web', 'api', 'background']
      for (const service of services) {
        const props = {
          policyId: policy.policyId,
          service: names.worker(service),
          enabled: monitoring.activate
        }
        yield* Cloudflare.Workers.IssueAutomation(`${service}-occurrences`, {
          ...props,
          name: `${prefix}/${service}/occurrences`,
          afterOccurrences: monitoring.issues.afterOccurrences
        })
        yield* Cloudflare.Workers.IssueAutomation(`${service}-recurrence`, {
          ...props,
          name: `${prefix}/${service}/recurrence`,
          afterInactivitySeconds: monitoring.issues.afterInactivitySeconds
        })
      }
    }
    if (monitoring.queueMonitor) {
      const { owner, repository, defaultBranch, queues } = monitoring.queueMonitor
      const target = { owner, repository }
      const environment = yield* GitHub.Environment('queue-monitor-environment', {
        ...target,
        name: 'operations-monitoring',
        deploymentBranchPolicy: { customBranchPolicies: [defaultBranch] }
      })
      const token = yield* Cloudflare.ApiToken.AccountApiToken('queue-monitor-token', {
        name: `${prefix}/queue-monitor`,
        policies: [
          {
            effect: 'allow',
            permissionGroups: ['Queues Read'],
            resources: { [`com.cloudflare.api.account.${accountId}`]: '*' }
          }
        ]
      })
      const accountSecret = yield* GitHub.Secret('queue-monitor-account', {
        ...target,
        environment: environment.name,
        name: 'CLOUDFLARE_ACCOUNT_ID',
        value: Redacted.make(accountId)
      })
      const tokenSecret = yield* GitHub.Secret('queue-monitor-credential', {
        ...target,
        environment: environment.name,
        name: 'CLOUDFLARE_API_TOKEN',
        value: token.value
      })
      const inventory = yield* GitHub.Variable('queue-monitor-inventory', {
        ...target,
        environment: environment.name,
        name: 'OPS_QUEUES',
        // Provider boundary publishes the queue-health CLI's JSON environment contract.
        // oxlint-disable-next-line effect/noGlobals -- GitHub variable transport is JSON text
        value: JSON.stringify(monitoringQueueTargets(monitoring.stage, queues))
      })
      const activate = monitoring.activate
      yield* GitHub.Variable('queue-monitor-gate', {
        ...target,
        name: 'OPS_MONITORING_ENABLED',
        value: Output.all(
          accountSecret.updatedAt,
          tokenSecret.updatedAt,
          inventory.updatedAt
        ).pipe(Output.map(() => String(activate)))
      })
    }
    return { enabled: true, active: monitoring.activate }
  })
)
