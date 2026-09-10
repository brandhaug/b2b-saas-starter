import { describe, expect, it } from 'vite-plus/test'
import {
  isPreviewStage,
  billingDeadLetterQueueName,
  billingConsumerSettings,
  billingReconciliationCron,
  billingQueueName,
  notificationEmailQueueName,
  productionStage,
  stageResourceNames,
  webhookDeadLetterQueueName,
  webhookQueueName,
  workersDevUrl
} from './bindings.ts'

describe('stageResourceNames', () => {
  it('keeps the historical production names for the prod stage', () => {
    const names = stageResourceNames(productionStage)
    expect(names.database).toBe('b2b-saas-starter')
    expect(names.webhookQueue).toBe(webhookQueueName)
    expect(names.webhookDeadLetterQueue).toBe(webhookDeadLetterQueueName)
    expect(names.billingQueue).toBe(billingQueueName)
    expect(names.billingDeadLetterQueue).toBe(billingDeadLetterQueueName)
    expect(names.notificationEmailQueue).toBe(notificationEmailQueueName)
    expect(names.worker('web')).toBe('b2b-saas-starter-web')
    expect(names.worker('api')).toBe('b2b-saas-starter-api')
    expect(names.worker('background')).toBe('b2b-saas-starter-background')
  })

  it('gives a preview stage its own database, queues, and workers', () => {
    const names = stageResourceNames('pr-42')
    expect(names.database).toBe('b2b-saas-starter-pr-42')
    expect(names.webhookQueue).toBe('b2b-saas-starter-pr-42-webhooks')
    expect(names.webhookDeadLetterQueue).toBe('b2b-saas-starter-pr-42-webhooks-dlq')
    expect(names.billingQueue).toBe('b2b-saas-starter-pr-42-billing')
    expect(names.billingDeadLetterQueue).toBe('b2b-saas-starter-pr-42-billing-dlq')
    expect(names.notificationEmailQueue).toBe(
      'b2b-saas-starter-pr-42-notification-emails'
    )
    expect(names.worker('web')).toBe('b2b-saas-starter-pr-42-web')
    expect(names.worker('background')).toBe('b2b-saas-starter-pr-42-background')
  })

  it('never lets two stages share a physical name', () => {
    const prod = stageResourceNames(productionStage)
    const preview = stageResourceNames('pr-7')
    const dev = stageResourceNames('dev_martin')
    const all = [prod, preview, dev].flatMap((names) => [
      names.database,
      names.webhookQueue,
      names.webhookDeadLetterQueue,
      names.billingQueue,
      names.billingDeadLetterQueue,
      names.notificationEmailQueue,
      names.workspaceExportBucket,
      names.worker('web'),
      names.worker('api'),
      names.worker('background')
    ])
    expect(new Set(all).size).toBe(all.length)
  })

  it('rejects stage names Alchemy would not accept', () => {
    expect(() => stageResourceNames('PR-1')).toThrow(/Invalid stage/)
    expect(() => stageResourceNames('pr 1')).toThrow(/Invalid stage/)
    expect(() => stageResourceNames('')).toThrow(/Invalid stage/)
  })
})

/**
 * Seconds between runs of a schedule whose only varying field is the minute —
 * enough to compare a repair cadence against a retry ladder without pulling in
 * a cron library.
 */
function cronIntervalSeconds(cron: string): number {
  const [minute, ...rest] = cron.split(' ')
  if (rest.length !== 4 || rest.some((field) => field !== '*')) {
    throw new Error(`Only minute-field schedules are supported here: ${cron}`)
  }
  const step = /^\*(?:\/(\d+))?$/.exec(minute ?? '')
  if (step === null) {
    throw new Error(`Unsupported cron minute field: ${cron}`)
  }
  return Number(step[1] ?? '1') * 60
}

describe('billing recovery bindings', () => {
  it('reconciles more often than the seat-sync consumer can exhaust its retries', () => {
    // Reconciliation is the repair pass for a seat sync that never converged.
    // It has to come round again before the consumer has finished giving up,
    // or a workspace waits out the whole retry ladder with a stale seat count.
    const ladderSeconds =
      billingConsumerSettings.maxRetries * (billingConsumerSettings.retryDelay ?? 0)
    expect(cronIntervalSeconds(billingReconciliationCron)).toBeLessThan(ladderSeconds)
  })
})

describe('isPreviewStage', () => {
  it('matches only pr-<number>', () => {
    expect(isPreviewStage('pr-1')).toBe(true)
    expect(isPreviewStage('pr-1234')).toBe(true)
    expect(isPreviewStage('prod')).toBe(false)
    expect(isPreviewStage('pr-')).toBe(false)
    expect(isPreviewStage('dev_martin')).toBe(false)
  })
})

describe('workersDevUrl', () => {
  it('builds the workers.dev URL the workflow and alchemy.run.ts share', () => {
    expect(workersDevUrl('b2b-saas-starter-pr-42-web', 'acme')).toBe(
      'https://b2b-saas-starter-pr-42-web.acme.workers.dev'
    )
  })
})
