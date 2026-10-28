import {
  type CustomAlertThresholdTrigger,
  type CustomAlertWindow
} from '@alchemy.run/cloudflare/Alerting/CustomAlert'
import { type NotificationPolicyMechanisms } from '@alchemy.run/cloudflare/Alerting/NotificationPolicy'
import { stageResourceNames, type WorkerApp } from './bindings.ts'

export type MonitoringQueueKey =
  | 'webhookQueue'
  | 'webhookDeadLetterQueue'
  | 'billingQueue'
  | 'billingDeadLetterQueue'
  | 'workspaceExportQueue'
  | 'notificationEmailQueue'
  | 'emailEventsQueue'

export type MonitoringConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true
      readonly accountId: string
      readonly stage: string
      /** Provision disabled resources first; activate only after the operator drill. */
      readonly activate: boolean
      /** Existing authorized destination IDs, never URLs, tokens or recipient addresses. */
      readonly destinations: Pick<
        NotificationPolicyMechanisms,
        'webhooks' | 'pagerduty'
      >
      readonly sqlAlerts: ReadonlyArray<{
        readonly key: string
        readonly service: WorkerApp
        /** Exact account- and Worker-scoped SQL, previewed against the deployed schema. */
        readonly query: string
        readonly trigger: CustomAlertThresholdTrigger
        readonly every: CustomAlertWindow
        /** Explicit authorization to adopt this exact existing same-name policy ID. */
        readonly adoptPolicyId?: string
        readonly verification: {
          readonly record: string
          readonly dataset: string
          readonly missingData: 'independent-watchdog'
          readonly watchdog: string
          readonly recovery: string
        }
      }>
      readonly issues?: {
        readonly adoptPolicyId?: string
        readonly afterOccurrences: number
        readonly afterInactivitySeconds: number
      }
      readonly queueMonitor?: {
        readonly owner: string
        readonly repository: string
        readonly defaultBranch: string
        readonly queues: MonitoringQueues
        /** Private reference to the independent ten-minute missed-run check. */
        readonly watchdog: string
      }
    }

type MonitoringQueues = Readonly<
  Record<Exclude<MonitoringQueueKey, 'workspaceExportQueue'>, string> & {
    workspaceExportQueue?: string
  }
>

export function monitoringQueueTargets(stage: string, queues: MonitoringQueues) {
  const names = stageResourceNames(stage)
  const keys: ReadonlyArray<MonitoringQueueKey> = [
    'webhookQueue',
    'webhookDeadLetterQueue',
    'billingQueue',
    'billingDeadLetterQueue',
    'workspaceExportQueue',
    'notificationEmailQueue',
    'emailEventsQueue'
  ]
  return keys.flatMap((key) =>
    queues[key] === undefined
      ? []
      : [
          {
            id: queues[key],
            name: names[key],
            deadLetter:
              key === 'webhookDeadLetterQueue' || key === 'billingDeadLetterQueue'
          }
        ]
  )
}

/** Validate operator input before declaring any provider resources. SQL semantics need the live drill. */
export function validateMonitoring(config: MonitoringConfig): void {
  if (!config.enabled) {
    return
  }
  stageResourceNames(config.stage)
  if (config.stage !== 'prod') {
    throw new Error('Monitoring has one owner and supports only the prod stage')
  }
  if (!/^[a-f0-9]{32}$/i.test(config.accountId)) {
    throw new Error('Monitoring requires a Cloudflare account ID')
  }
  const destinations = [
    ...(config.destinations.webhooks ?? []),
    ...(config.destinations.pagerduty ?? [])
  ]
  if (!destinations.length || destinations.some(({ id }) => !id.trim())) {
    throw new Error('Monitoring requires an authorized destination ID')
  }
  const keys = new Set<string>()
  for (const rule of config.sqlAlerts) {
    const key = `${rule.service}/${rule.key}`
    if (!/^[a-z0-9-]+$/.test(rule.key) || keys.has(key)) {
      throw new Error(
        'Monitoring rule keys must be unique per service and use lowercase slugs'
      )
    }
    keys.add(key)
    if (!rule.query.trim() || rule.query.trim().endsWith(';')) {
      throw new Error('Monitoring SQL must be nonempty without a trailing semicolon')
    }
    if (
      !rule.verification.record.trim() ||
      !rule.verification.dataset.trim() ||
      !rule.verification.recovery.trim()
    ) {
      throw new Error(
        'Monitoring requires a verified schema/query record and recovery procedure'
      )
    }
    if (!rule.verification.watchdog.trim()) {
      throw new Error('Monitoring requires an independent missing-data watchdog')
    }
    if (
      ![rule.every, rule.trigger.window].every((window) =>
        /^[1-9]\d*[mh]$/.test(window)
      ) ||
      !Number.isFinite(rule.trigger.value)
    ) {
      throw new Error(
        'Monitoring requires positive evaluation windows and a finite threshold'
      )
    }
  }
  if (
    config.issues &&
    (!Number.isSafeInteger(config.issues.afterOccurrences) ||
      config.issues.afterOccurrences < 1 ||
      !Number.isSafeInteger(config.issues.afterInactivitySeconds) ||
      config.issues.afterInactivitySeconds < 3600 ||
      config.issues.afterInactivitySeconds > 31_536_000)
  ) {
    throw new Error('Issue occurrence count or inactivity bounds are invalid')
  }
  if (config.queueMonitor) {
    const monitor = config.queueMonitor
    if (
      ![
        monitor.owner,
        monitor.repository,
        monitor.defaultBranch,
        monitor.watchdog
      ].every((value) => value.trim())
    ) {
      throw new Error(
        'Queue monitoring requires repository, branch and watchdog configuration'
      )
    }
    const targets = monitoringQueueTargets(config.stage, monitor.queues)
    if (
      targets.some(({ id }) => !/^[a-f0-9]{32}$/i.test(id)) ||
      new Set(targets.map(({ id }) => id)).size !== targets.length
    ) {
      throw new Error(
        'Queue monitoring requires distinct IDs for the deployed stage queues'
      )
    }
  }
}
