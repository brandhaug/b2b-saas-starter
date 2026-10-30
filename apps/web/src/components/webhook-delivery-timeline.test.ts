import {
  type WebhookDelivery,
  type WebhookDeliveryAttempt
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { Deferred, Effect } from 'effect'
import { fireEvent, screen } from '@testing-library/dom'
import { expect, it, vi } from 'vite-plus/test'
import { renderWorkspace } from '@/foldkit/workspace/test-harness'
import { demoFixtures } from '@/lib/demo-fixtures'
import * as Api from '@/lib/server/webhooks'
type ListDeliveryAttempts = typeof Api.listWebhookDeliveryAttemptsServerFn

async function renderTimeline(
  delivery: WebhookDelivery,
  listAttempts: ListDeliveryAttempts
) {
  vi.spyOn(Api, 'listWebhookDeliveryAttemptsServerFn').mockImplementation(listAttempts)
  return renderWorkspace(
    {
      _tag: 'webhooks',
      data: {
        ...demoFixtures.webhooks,
        endpoints: [
          {
            id: delivery.endpointId,
            url: 'https://example.com/hook',
            enabled: true,
            events: ['webhook.test_event'],
            successRate: 100,
            deliveries: [delivery]
          }
        ]
      }
    },
    { url: `/workspaces/starter-lab/webhooks?record=${delivery.endpointId}` }
  )
}

const delivery: WebhookDelivery = {
  id: 'delivery',
  endpointId: 'endpoint',
  eventType: 'webhook.test_event',
  status: 'delivered',
  attempts: 2,
  lastAttemptAt: '2026-09-01T12:00:00.000Z',
  nextAttemptAt: null,
  responseStatus: 200,
  payload: { event: 'test' },
  requestHeaders: null,
  responseBody: null,
  replayedFrom: null
}
const failed = {
  id: 'attempt-1',
  deliveryId: 'delivery',
  attempts: 1,
  phase: 'http',
  status: 'pending',
  attemptedAt: '2026-09-01T11:59:00.000Z',
  durationMs: 123,
  failureReason: 'Receiver returned HTTP 503',
  responseStatus: 503,
  requestHeaders: { 'webhook-id': 'delivery' },
  responseBody: 'Temporarily unavailable'
} satisfies WebhookDeliveryAttempt

it('fetches evidence only on expansion and preserves a failed attempt before success', async () => {
  const listAttempts = vi.fn<ListDeliveryAttempts>().mockResolvedValue([
    failed,
    {
      ...failed,
      id: 'attempt-2',
      attempts: 2,
      status: 'delivered',
      durationMs: 24,
      failureReason: null,
      responseStatus: 200,
      responseBody: ''
    }
  ])
  await renderTimeline(delivery, listAttempts)
  expect(listAttempts).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'View attempt history' }))
  await screen.findByText('Temporarily unavailable')
  expect(screen.getByText('HTTP 200')).not.toBeNull()
  expect(screen.getByText('123 ms')).not.toBeNull()
  expect(screen.getByRole('list', { name: 'Attempt history' }).textContent).toMatch(
    /Attempt 1.*Attempt 2/
  )
  expect(listAttempts).toHaveBeenCalledWith({
    data: { workspaceSlug: 'starter-lab', deliveryId: 'delivery' }
  })
})

it('shows a read error with retry and reports an empty retained history', async () => {
  const listAttempts = vi
    .fn<ListDeliveryAttempts>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue([])
  await renderTimeline(delivery, listAttempts)
  fireEvent.click(screen.getByRole('button', { name: 'View attempt history' }))
  await screen.findByText('Could not load attempt history.')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText(/No retained attempts/)
})

it('shows loading followed by a never-dispatched terminal outcome', async () => {
  const result = Effect.runSync(Deferred.make<ReadonlyArray<WebhookDeliveryAttempt>>())
  const listAttempts = vi
    .fn<ListDeliveryAttempts>()
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- Bridge the deterministic Deferred to the listAttempts Promise port consumed by React Query.
    .mockReturnValue(Effect.runPromise(Deferred.await(result)))
  await renderTimeline(delivery, listAttempts)
  fireEvent.click(screen.getByRole('button', { name: 'View attempt history' }))
  const loading = await screen.findByText('Loading attempt history…')
  expect(loading.tagName).toBe('OUTPUT')
  Effect.runSync(
    Deferred.succeed(result, [
      {
        ...failed,
        id: 'terminal',
        attempts: 0,
        phase: 'terminal',
        status: 'failed',
        durationMs: null,
        failureReason: 'Endpoint was disabled before dispatch',
        requestHeaders: null,
        responseStatus: null,
        responseBody: null
      }
    ])
  )
  await screen.findByText('Endpoint was disabled before dispatch')
  expect(screen.getByText('Terminal outcome')).not.toBeNull()
  expect(screen.queryByText('Request headers')).toBeNull()
  expect(screen.queryByText('Response body')).toBeNull()
  expect(screen.getByText(/"event": "test"/)).not.toBeNull()
})

it.each(['failed_permanent', 'dead_lettered'] satisfies ReadonlyArray<
  WebhookDeliveryAttempt['status']
>)('presents terminal outcome %s as a readable failure', async (status) => {
  await renderTimeline({ ...delivery, status }, async () => [
    { ...failed, phase: 'terminal', status }
  ])
  fireEvent.click(screen.getByRole('button', { name: 'View attempt history' }))
  const label =
    status === 'failed_permanent' ? 'permanently failed' : 'sent to dead-letter queue'
  const badge = await screen.findByText(label)
  expect(badge.getAttribute('data-variant')).toBe('destructive')
  expect(screen.queryByText(status)).toBeNull()
})
