import {
  type WebhookDelivery,
  type WebhookDeliveryAttempt
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { Deferred, Effect } from 'effect'
import { fireEvent, screen } from '@testing-library/react'
import { expect, it, vi } from 'vite-plus/test'
import { renderWithQueryClient } from '@/test/query-harness'
import {
  WebhookDeliveryTimeline,
  type ListDeliveryAttempts
} from './webhook-delivery-timeline'

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
  renderWithQueryClient(
    <WebhookDeliveryTimeline
      workspaceSlug="starter-lab"
      delivery={delivery}
      listAttempts={listAttempts}
    />
  )
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
  renderWithQueryClient(
    <WebhookDeliveryTimeline
      workspaceSlug="starter-lab"
      delivery={delivery}
      listAttempts={listAttempts}
    />
  )
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
  renderWithQueryClient(
    <WebhookDeliveryTimeline
      workspaceSlug="starter-lab"
      delivery={delivery}
      listAttempts={listAttempts}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'View attempt history' }))
  expect(screen.getByRole('status').textContent).toContain('Loading attempt history')
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
