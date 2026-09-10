import { describe, expect, it } from 'vite-plus/test'

import { productionStage, stageResourceNames } from '@b2b-saas-starter/infra'
import { buildWorkspaceExport } from './export-consumer.ts'
import { sendNotificationEmail } from './notification-email-consumer.ts'
import { consumeEmailEvent } from './email-events-consumer.ts'
import { deliverSeatSync } from './seat-sync-consumer.ts'
import { recoverBillingDeadLetter } from './billing-dead-letter-consumer.ts'
import { deliverWebhook, recordDeadLetter } from './webhook-consumer.ts'
import { queueConsumerFor } from './queue-routing.ts'

/**
 * The deploy binds this worker to the names `stageResourceNames` builds, and
 * every stage but production prefixes them. The routing table is what keeps a
 * preview stage's export or billing message from reaching the webhook
 * consumer, so it is checked against both name shapes.
 */
function expected(
  names: ReturnType<typeof stageResourceNames>
): ReadonlyArray<readonly [string, ReturnType<typeof queueConsumerFor>]> {
  return [
    [names.webhookQueue, deliverWebhook],
    [names.webhookDeadLetterQueue, recordDeadLetter],
    [names.billingQueue, deliverSeatSync],
    [names.billingDeadLetterQueue, recoverBillingDeadLetter],
    [names.workspaceExportQueue, buildWorkspaceExport],
    [names.notificationEmailQueue, sendNotificationEmail],
    [names.emailEventsQueue, consumeEmailEvent]
  ]
}

describe('queueConsumerFor', () => {
  it('routes every production queue to its consumer', () => {
    for (const [queue, consumer] of expected(stageResourceNames(productionStage))) {
      expect(queueConsumerFor(queue)).toBe(consumer)
    }
  })

  it('routes the prefixed queues of a preview stage to the same consumers', () => {
    const names = stageResourceNames('pr-1')
    // The prefix is what the old equality branch missed.
    expect(names.workspaceExportQueue).toBe('b2b-saas-starter-pr-1-workspace-exports')
    expect(names.billingDeadLetterQueue).toBe('b2b-saas-starter-pr-1-billing-dlq')
    for (const [queue, consumer] of expected(names)) {
      expect(queueConsumerFor(queue)).toBe(consumer)
    }
  })

  it('claims no consumer for a queue this worker is not bound to', () => {
    // A dead-letter name must not fall through to its primary queue's
    // consumer, and an unknown name must not fall through to the webhooks.
    expect(queueConsumerFor('b2b-saas-starter-pr-1-email-events-dlq')).toBeUndefined()
    expect(queueConsumerFor('b2b-saas-starter-pr-1-unbound')).toBeUndefined()
  })
})
