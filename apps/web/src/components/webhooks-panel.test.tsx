import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  WebhooksPanel,
  type UpdateWebhookEndpoint,
  type RotateWebhookSecret
} from './webhooks-panel'
import { type ReplayDelivery, type SendTestEvent } from './webhook-deliveries-drawer'
import { renderWithRouter } from '@/test/router-harness'

const delivery: WebhookDelivery = {
  id: 'dlv_1',
  endpointId: 'whe_1',
  eventType: 'api_token.created',
  status: 'delivered',
  attempts: 1,
  lastAttemptAt: '2026-05-16T09:00:00.000Z',
  nextAttemptAt: null,
  responseStatus: 200,
  payload: { hello: 'world' },
  requestHeaders: { 'x-b2b-starter-event': 'api_token.created' },
  responseBody: '',
  replayedFrom: null
}

const failedDelivery: WebhookDelivery = {
  ...delivery,
  id: 'dlv_2',
  status: 'failed',
  attempts: 3,
  responseStatus: 500,
  responseBody: 'upstream connect error'
}

const endpoint: WebhookEndpoint & {
  readonly deliveries: ReadonlyArray<WebhookDelivery>
} = {
  id: 'whe_1',
  url: 'https://example.com/hooks/b2b-starter',
  enabled: true,
  events: ['api_token.created'],
  successRate: 100,
  deliveries: [delivery]
}

const updateEndpoint = vi.fn<UpdateWebhookEndpoint>()
const rotateSecret = vi.fn<RotateWebhookSecret>()
const replayDelivery = vi.fn<ReplayDelivery>()
const sendTestEvent = vi.fn<SendTestEvent>()

function renderPanel(input: {
  readonly role: 'owner' | 'member'
  readonly endpoints?: ReadonlyArray<typeof endpoint>
}) {
  return renderWithRouter(
    <WebhooksPanel
      workspaceSlug="starter-lab"
      endpoints={input.endpoints ?? [endpoint]}
      viewer={{ role: input.role }}
      updateEndpoint={updateEndpoint}
      rotateSecret={rotateSecret}
      replayDelivery={replayDelivery}
      sendTestEvent={sendTestEvent}
    />
  )
}

describe('WebhooksPanel', () => {
  beforeEach(() => {
    updateEndpoint.mockReset()
    updateEndpoint.mockResolvedValue(endpoint)
    rotateSecret.mockReset()
    rotateSecret.mockResolvedValue('whsec_rotated')
    replayDelivery.mockReset()
    sendTestEvent.mockReset()
  })

  it('offers the create form and the row controls to a role that holds them', async () => {
    await renderPanel({ role: 'owner' })
    expect(screen.getByRole('heading', { name: 'Register an endpoint' })).toBeTruthy()
    expect(screen.getByLabelText('Endpoint URL')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Disable' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rotate secret' })).toBeTruthy()
  })

  it('replaces the form with its reason for a role that cannot register', async () => {
    await renderPanel({ role: 'member' })
    expect(screen.getByText('Your role cannot register endpoints.')).toBeTruthy()
    expect(screen.queryByLabelText('Endpoint URL')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rotate secret' })).toBeNull()
  })

  it('shows the empty state with no endpoints', async () => {
    await renderPanel({ role: 'owner', endpoints: [] })
    expect(screen.getByText('No endpoints registered')).toBeTruthy()
  })

  it('renders the delivery timestamp in UTC', async () => {
    await renderPanel({ role: 'owner' })
    expect(screen.getByText(/5\/16\/2026, 9:00:00 AM/)).toBeTruthy()
  })

  it('reveals the rotated secret once', async () => {
    await renderPanel({ role: 'owner' })
    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }))
    await screen.findByText('Secret rotated. Copy it now, it will not be shown again.')
    expect(rotateSecret).toHaveBeenCalledWith({
      data: { workspaceSlug: 'starter-lab', endpointId: 'whe_1' }
    })
  })

  it('surfaces a failure from either mutation in the one alert', async () => {
    updateEndpoint.mockRejectedValue(new Error('Endpoint already disabled'))
    await renderPanel({ role: 'owner' })
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm disable' }))
    await waitFor(() => {
      expect(screen.getByText('Endpoint already disabled')).toBeTruthy()
    })
  })
})

describe('WebhookDeliveriesDrawer', () => {
  const endpointWithFailure = {
    ...endpoint,
    deliveries: [delivery, failedDelivery]
  }

  it('opens per endpoint and shows the attempt timeline with evidence', async () => {
    await renderPanel({ role: 'owner', endpoints: [endpointWithFailure] })
    fireEvent.click(screen.getByRole('button', { name: /Delivery attempts \(2\)/ }))
    await screen.findByRole('dialog')
    // The timeline lists both attempts with the recorded response status...
    expect(screen.getAllByText('failed').length).toBeGreaterThan(0)
    expect(screen.getByText('HTTP 500')).toBeTruthy()
    // ...and the recorded evidence for the failed row.
    expect(screen.getByText('upstream connect error')).toBeTruthy()
    expect(screen.getAllByText(/x-b2b-starter-event/).length).toBeGreaterThan(0)
  })

  it('offers Replay on failed rows and queues it through the port', async () => {
    replayDelivery.mockResolvedValue({ deliveryId: 'dlv_replayed' })
    await renderPanel({ role: 'owner', endpoints: [endpointWithFailure] })
    fireEvent.click(screen.getByRole('button', { name: /Delivery attempts \(2\)/ }))
    const replayButton = await screen.findByRole('button', { name: 'Replay' })
    fireEvent.click(replayButton)
    await waitFor(() => {
      expect(replayDelivery).toHaveBeenCalledWith({
        data: { workspaceSlug: 'starter-lab', deliveryId: 'dlv_2' }
      })
    })
    // The delivered row never gets one.
    expect(screen.getAllByRole('button', { name: 'Replay' })).toHaveLength(1)
  })

  it('queues a test event from the drawer', async () => {
    sendTestEvent.mockResolvedValue({ deliveryId: 'dlv_test' })
    await renderPanel({ role: 'owner', endpoints: [endpointWithFailure] })
    fireEvent.click(screen.getByRole('button', { name: /Delivery attempts \(2\)/ }))
    const testButton = await screen.findByRole('button', { name: 'Send test event' })
    fireEvent.click(testButton)
    await waitFor(() => {
      expect(sendTestEvent).toHaveBeenCalledWith({
        data: { workspaceSlug: 'starter-lab', endpointId: 'whe_1' }
      })
    })
  })

  it('hides the operator actions from a role that cannot replay or test', async () => {
    await renderPanel({ role: 'member', endpoints: [endpointWithFailure] })
    fireEvent.click(screen.getByRole('button', { name: /Delivery attempts \(2\)/ }))
    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send test event' })).toBeNull()
  })
})
