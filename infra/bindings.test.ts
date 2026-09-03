import { describe, expect, it } from 'vite-plus/test'
import {
  isPreviewStage,
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
      names.notificationEmailQueue,
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
