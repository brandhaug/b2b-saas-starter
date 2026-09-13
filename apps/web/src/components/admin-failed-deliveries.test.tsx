import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { AdminFailedDeliveries } from './admin-failed-deliveries'
import {
  replayFailedDeliveryServerFn,
  type FailedDeliveriesPayload
} from '@/lib/server/admin'

vi.mock('@/lib/server/admin', () => ({
  replayFailedDeliveryServerFn: vi.fn()
}))

function deferred<A>() {
  let settle: ((value: A) => void) | undefined
  const promise = new Promise<A>((resolve) => {
    settle = resolve
  })
  if (settle === undefined) {
    throw new Error('Promise executor did not run synchronously')
  }
  return { promise, resolve: settle }
}

const initialPage: FailedDeliveriesPayload = {
  items: [
    {
      id: 'whd_terminal',
      endpointId: 'wh_failed',
      endpointUrl: 'https://receiver.example.com/hook',
      endpointEnabled: false,
      endpointConsecutiveFailures: 20,
      endpointFailureLimitReached: true,
      eventType: 'demo.event',
      status: 'dead_lettered',
      attempts: 6,
      lastAttemptAt: '2026-09-01T00:00:00.000Z',
      responseStatus: 503,
      workspace: {
        id: 'wrk_1',
        slug: 'first-workspace',
        name: 'First workspace',
        planId: 'team'
      }
    }
  ],
  nextCursor: 'older-cursor'
}

describe('AdminFailedDeliveries', () => {
  beforeEach(() => {
    vi.mocked(replayFailedDeliveryServerFn).mockReset()
  })

  it('identifies disabled endpoints at the failure limit and shows the server refusal inline', async () => {
    vi.mocked(replayFailedDeliveryServerFn).mockResolvedValue({
      status: 'refused',
      reason: 'Endpoint was disabled. Re-enable it in the workspace.'
    })
    await renderWithRouter(<AdminFailedDeliveries initialPage={initialPage} />, {
      path: '/admin'
    })
    expect(screen.getByText(/Auto-disable threshold reached/)).not.toBeNull()
    expect(screen.getByText('First workspace')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Replay whd_terminal' }))
    expect(
      await screen.findByText('Endpoint was disabled. Re-enable it in the workspace.')
    ).not.toBeNull()
  })

  it('acknowledges a queued copy without hiding the source or offering an immediate duplicate', async () => {
    vi.mocked(replayFailedDeliveryServerFn).mockResolvedValue({
      status: 'queued',
      deliveryId: 'whd_copy'
    })
    await renderWithRouter(<AdminFailedDeliveries initialPage={initialPage} />, {
      path: '/admin'
    })
    fireEvent.click(screen.getByRole('button', { name: 'Replay whd_terminal' }))
    expect(await screen.findByText(/Queued as whd_copy/)).not.toBeNull()
    expect(screen.getByText('dead_lettered')).not.toBeNull()
    expect(
      screen
        .getByRole('button', { name: 'Replay whd_terminal' })
        .hasAttribute('disabled')
    ).toBe(true)
  })

  it('puts the opaque cursor in the URL and clears it when returning to newest', async () => {
    const { router } = await renderWithRouter(
      <AdminFailedDeliveries initialPage={initialPage} />,
      { path: '/admin' }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Older failures' }))
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        failureCursor: 'older-cursor'
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh newest' }))
    await waitFor(() =>
      expect(router.state.location.search.failureCursor).toBeUndefined()
    )
  })

  it('shows a failed enqueue instead of claiming success', async () => {
    vi.mocked(replayFailedDeliveryServerFn).mockRejectedValue(
      new Error('Queue unavailable')
    )
    await renderWithRouter(<AdminFailedDeliveries initialPage={initialPage} />, {
      path: '/admin'
    })
    fireEvent.click(screen.getByRole('button', { name: 'Replay whd_terminal' }))
    expect(
      await screen.findByText(/Replay failed\. A pending copy may already exist\./)
    ).not.toBeNull()
    expect(screen.queryByText(/Queued as/)).toBeNull()
  })

  it('disables replay while enqueue is pending and permits retry after refusal', async () => {
    const response =
      deferred<Awaited<ReturnType<typeof replayFailedDeliveryServerFn>>>()
    vi.mocked(replayFailedDeliveryServerFn).mockReturnValue(response.promise)
    await renderWithRouter(<AdminFailedDeliveries initialPage={initialPage} />, {
      path: '/admin'
    })
    fireEvent.click(screen.getByRole('button', { name: 'Replay whd_terminal' }))
    expect(await screen.findByText('Queuing…')).toHaveProperty('disabled', true)
    expect(screen.queryByText(/Queued as/)).toBeNull()
    await act(async () => {
      response.resolve({ status: 'refused', reason: 'Endpoint is disabled' })
    })
    expect(screen.getByText('Endpoint is disabled')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Replay whd_terminal' })).toHaveProperty(
      'disabled',
      false
    )
  })

  it('keeps server order and disables pagination on the last page', async () => {
    await renderWithRouter(
      <AdminFailedDeliveries initialPage={{ ...initialPage, nextCursor: null }} />,
      { path: '/admin' }
    )
    expect(screen.getByRole('button', { name: 'Older failures' })).toHaveProperty(
      'disabled',
      true
    )
    expect(screen.queryByRole('button', { name: /Sort by/ })).toBeNull()
  })
})
