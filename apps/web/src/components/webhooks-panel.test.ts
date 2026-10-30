import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWorkspace } from '@/foldkit/workspace/test-harness'
import { input as enter } from './native-test-harness'
import { demoFixtures } from '@/lib/demo-fixtures'
import * as Api from '@/lib/server/webhooks'

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
  requestHeaders: { 'webhook-id': 'dlv_1' },
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

const updateEndpoint = vi.fn<typeof Api.updateWebhookEndpointServerFn>()
const rotateSecret = vi.fn<typeof Api.rotateWebhookSecretServerFn>()
const replayDelivery = vi.fn<typeof Api.replayWebhookDeliveryServerFn>()
const sendTestEvent = vi.fn<typeof Api.sendTestEventServerFn>()

async function renderPanel(input: {
  readonly role: 'owner' | 'member'
  readonly endpoints?: ReadonlyArray<typeof endpoint>
  readonly initialEntry?: string
}) {
  const data = {
    ...demoFixtures.webhooks,
    endpoints: input.endpoints ?? [endpoint],
    viewer: { role: input.role }
  }
  vi.spyOn(Api, 'updateWebhookEndpointServerFn').mockImplementation(updateEndpoint)
  vi.spyOn(Api, 'rotateWebhookSecretServerFn').mockImplementation(rotateSecret)
  vi.spyOn(Api, 'replayWebhookDeliveryServerFn').mockImplementation(replayDelivery)
  vi.spyOn(Api, 'sendTestEventServerFn').mockImplementation(sendTestEvent)
  vi.spyOn(Api, 'loadWorkspaceWebhooksServerFn').mockResolvedValue(data)
  const view = await renderWorkspace(
    { _tag: 'webhooks', data },
    { url: input.initialEntry ?? '/workspaces/starter-lab/webhooks' }
  )
  return {
    ...view,
    router: {
      state: {
        get location() {
          return {
            search: Object.fromEntries(new URL(window.location.href).searchParams)
          }
        }
      },
      history: window.history
    }
  }
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
    fireEvent.click(
      screen.getByRole('button', { name: `More actions for ${endpoint.url}` })
    )
    expect(screen.getByRole('menuitem', { name: 'Disable' })).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Rotate secret' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Register an endpoint' }))
    expect(await screen.findByLabelText('Endpoint URL')).not.toBeNull()
  })

  it('replaces the form with its reason for a role that cannot register', async () => {
    await renderPanel({ role: 'member' })
    expect(screen.getByText('Your role cannot register endpoints.')).not.toBeNull()
    expect(screen.queryByLabelText('Endpoint URL')).toBeNull()
    expect(
      screen.queryByRole('button', { name: `More actions for ${endpoint.url}` })
    ).toBeNull()
  })

  it('filters endpoints by enabled status and URL', async () => {
    const tableViews = encodeURIComponent(
      JSON.stringify({
        webhooks: JSON.stringify({
          match: 'all',
          filters: [{ field: 'status', operator: 'is', value: 'disabled' }],
          sorts: []
        })
      })
    )
    await renderPanel({
      role: 'owner',
      initialEntry: `/?tableViews=${tableViews}`,
      endpoints: [
        endpoint,
        {
          ...endpoint,
          id: 'whe_disabled',
          url: 'https://disabled.example/hooks',
          enabled: false
        }
      ]
    })
    expect(screen.getByText('https://disabled.example/hooks')).not.toBeNull()
    expect(screen.queryByText(endpoint.url)).toBeNull()
  })

  it('stores search and sort choices in the URL', async () => {
    const tableViews = encodeURIComponent(
      JSON.stringify({
        webhooks: JSON.stringify({
          match: 'all',
          filters: [],
          sorts: [
            { field: 'successRate', direction: 'desc' },
            { field: 'url', direction: 'asc' }
          ]
        })
      })
    )
    const { router } = await renderPanel({
      role: 'owner',
      initialEntry: `/?tableViews=${tableViews}`
    })
    await enter(screen.getByRole('textbox', { name: 'Search endpoints' }), 'example')
    await waitFor(() => expect(router.state.location.search.query).toBe('example'))
    expect(screen.getByText(endpoint.url)).not.toBeNull()
  })

  it('sorts before pagination and resets the page when searching', async () => {
    const endpoints = Array.from({ length: 21 }, (_, index) => ({
      ...endpoint,
      id: `row_${index}`,
      url: `https://example.com/${String(index).padStart(2, '0')}`
    }))
    const tableViews = encodeURIComponent(
      JSON.stringify({
        webhooks: JSON.stringify({
          match: 'all',
          filters: [],
          sorts: [{ field: 'url', direction: 'desc' }]
        })
      })
    )
    const { router } = await renderPanel({
      role: 'owner',
      endpoints,
      initialEntry: `/?page=2&tableViews=${tableViews}`
    })
    expect(screen.getByText('https://example.com/00')).not.toBeNull()
    expect(screen.queryByText('https://example.com/20')).toBeNull()
    const savedViews = router.state.location.search.tableViews
    await enter(screen.getByRole('textbox', { name: 'Search endpoints' }), '20')
    await waitFor(() => expect(router.state.location.search.page).toBeUndefined())
    expect(screen.getByText('https://example.com/20')).not.toBeNull()
    expect(router.state.location.search.tableViews).toEqual(savedViews)
  })

  it('resets the page when changing a status filter', async () => {
    const endpoints = Array.from({ length: 21 }, (_, index) => ({
      ...endpoint,
      id: `row_${index}`,
      url: `https://example.com/${String(index).padStart(2, '0')}`
    }))
    const { router } = await renderPanel({
      role: 'owner',
      endpoints,
      initialEntry: '/?page=2'
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Status' })[0]!)
    fireEvent.click(await screen.findByRole('radio', { name: 'Enabled' }))
    await waitFor(() => expect(router.state.location.search.page).toBeUndefined())
    expect(screen.getByText('https://example.com/00')).not.toBeNull()
    expect(screen.queryByText('https://example.com/20')).toBeNull()
  })

  it('clears this list without clearing another saved view or drawer state', async () => {
    const other = JSON.stringify({
      match: 'all',
      filters: [],
      sorts: [{ field: 'name', direction: 'asc' }]
    })
    const tableViews = encodeURIComponent(
      JSON.stringify({
        other,
        webhooks: JSON.stringify({
          match: 'all',
          filters: [{ field: 'status', operator: 'is', value: 'disabled' }],
          sorts: []
        })
      })
    )
    const { router } = await renderPanel({
      role: 'owner',
      initialEntry: `/?query=missing&page=3&record=keep&tableViews=${tableViews}`
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(screen.getByText(endpoint.url)).not.toBeNull())
    expect(router.state.location.search.query).toBeUndefined()
    expect(router.state.location.search.page).toBeUndefined()
    expect(router.state.location.search.record).toBe('keep')
    expect(router.state.location.search.tableViews).toBe(JSON.stringify({ other }))
  })

  it('reveals the rotated secret once', async () => {
    await renderPanel({ role: 'owner' })
    fireEvent.click(
      screen.getByRole('button', { name: `More actions for ${endpoint.url}` })
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rotate secret' }))
    await screen.findByText('Secret rotated. Copy it now, it will not be shown again.')
    expect(rotateSecret).toHaveBeenCalledWith({
      data: { workspaceSlug: 'starter-lab', endpointId: 'whe_1' }
    })
  })

  it('surfaces a failure from either mutation on the row it happened on', async () => {
    updateEndpoint.mockRejectedValue(new Error('Endpoint already disabled'))
    await renderPanel({ role: 'owner' })
    fireEvent.click(
      screen.getByRole('button', { name: `More actions for ${endpoint.url}` })
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disable' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm disable' }))
    await waitFor(() => {
      expect(screen.getByText('Could not disable endpoint.')).not.toBeNull()
    })
    // The failure renders inside the endpoint's row, not at the panel foot.
    const row = screen
      .getByText('https://example.com/hooks/b2b-starter')
      .closest('[role="listitem"]')
    expect(row?.textContent).toContain('Could not disable endpoint.')
  })
})

describe('WebhookDeliveriesDrawer', () => {
  const endpointWithFailure = {
    ...endpoint,
    deliveries: [delivery, failedDelivery]
  }

  it('opens per endpoint and shows the attempt timeline with evidence', async () => {
    await renderPanel({ role: 'owner', endpoints: [endpointWithFailure] })
    fireEvent.click(screen.getByRole('button', { name: /Deliveries \(2\)/ }))
    await screen.findByRole('dialog')
    // The timeline lists both attempts with the recorded response status...
    expect(screen.getAllByText('failed').length).toBeGreaterThan(0)
    expect(screen.getByText('HTTP 500')).not.toBeNull()
    // ...and the recorded evidence for the failed row.
    expect(screen.queryByText('upstream connect error')).toBeNull()
    expect(
      screen.getAllByRole('button', { name: 'View attempt history' })
    ).toHaveLength(2)
  })

  it('opens the drawer through the URL and browser Back closes it', async () => {
    const { router } = await renderPanel({
      role: 'owner',
      endpoints: [endpointWithFailure]
    })
    fireEvent.click(screen.getByRole('button', { name: /Deliveries \(2\)/ }))
    await screen.findByRole('dialog')
    expect(router.state.location.search.record).toBe('whe_1')
    router.history.back()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(router.state.location.search.record).toBeUndefined()
  })

  it('offers Replay on failed rows and queues it through the port', async () => {
    replayDelivery.mockResolvedValue({ deliveryId: 'dlv_replayed' })
    await renderPanel({ role: 'owner', endpoints: [endpointWithFailure] })
    fireEvent.click(screen.getByRole('button', { name: /Deliveries \(2\)/ }))
    await screen.findByRole('dialog')
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
    fireEvent.click(screen.getByRole('button', { name: /Deliveries \(2\)/ }))
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
    fireEvent.click(screen.getByRole('button', { name: /Deliveries \(2\)/ }))
    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send test event' })).toBeNull()
  })
})
