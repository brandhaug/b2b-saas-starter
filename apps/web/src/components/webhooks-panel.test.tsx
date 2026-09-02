import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  WebhooksPanel,
  type DisableWebhookEndpoint,
  type RotateWebhookSecret
} from './webhooks-panel'
import { renderWithRouter } from '@/test/router-harness'

const delivery: WebhookDelivery = {
  id: 'dlv_1',
  endpointId: 'whe_1',
  eventType: 'api_token.created',
  status: 'delivered',
  attempts: 1,
  lastAttemptAt: '2026-05-16T09:00:00.000Z',
  nextAttemptAt: null,
  responseStatus: 200
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

const disableEndpoint = vi.fn<DisableWebhookEndpoint>()
const rotateSecret = vi.fn<RotateWebhookSecret>()

function renderPanel(input: {
  readonly role: 'owner' | 'member'
  readonly endpoints?: ReadonlyArray<typeof endpoint>
}) {
  return renderWithRouter(
    <WebhooksPanel
      workspaceSlug="starter-lab"
      endpoints={input.endpoints ?? [endpoint]}
      viewer={{ role: input.role }}
      disableEndpoint={disableEndpoint}
      rotateSecret={rotateSecret}
    />
  )
}

describe('WebhooksPanel', () => {
  beforeEach(() => {
    disableEndpoint.mockReset()
    disableEndpoint.mockResolvedValue(true)
    rotateSecret.mockReset()
    rotateSecret.mockResolvedValue('whsec_rotated')
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
    disableEndpoint.mockRejectedValue(new Error('Endpoint already disabled'))
    await renderPanel({ role: 'owner' })
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm disable' }))
    await waitFor(() => {
      expect(screen.getByText('Endpoint already disabled')).toBeTruthy()
    })
  })
})
