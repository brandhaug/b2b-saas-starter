import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AdminFailedDeliveries } from './admin-failed-deliveries'
import {
  loadFailedDeliveriesServerFn,
  replayFailedDeliveryServerFn,
  type FailedDeliveriesPayload
} from '@/lib/server/admin'

vi.mock('@/lib/server/admin', () => ({
  loadFailedDeliveriesServerFn: vi.fn(),
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
    vi.mocked(loadFailedDeliveriesServerFn).mockReset()
    vi.mocked(replayFailedDeliveryServerFn).mockReset()
  })

  it('identifies disabled endpoints at the failure limit and shows the server refusal inline', async () => {
    vi.mocked(replayFailedDeliveryServerFn).mockResolvedValue({
      status: 'refused',
      reason: 'Endpoint was disabled. Re-enable it in the workspace.'
    })
    render(<AdminFailedDeliveries initialPage={initialPage} />)
    expect(screen.getByText(/Auto-disable threshold reached/)).toBeTruthy()
    expect(screen.getByText('First workspace')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Replay whd_terminal' }))
    expect(
      await screen.findByText('Endpoint was disabled. Re-enable it in the workspace.')
    ).toBeTruthy()
  })

  it('acknowledges a queued copy without hiding the source or offering an immediate duplicate', async () => {
    vi.mocked(replayFailedDeliveryServerFn).mockResolvedValue({
      status: 'queued',
      deliveryId: 'whd_copy'
    })
    render(<AdminFailedDeliveries initialPage={initialPage} />)
    fireEvent.click(screen.getByRole('button', { name: 'Replay whd_terminal' }))
    expect(await screen.findByText(/Queued as whd_copy/)).toBeTruthy()
    expect(screen.getByText('dead_lettered')).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Replay whd_terminal' })
        .hasAttribute('disabled')
    ).toBe(true)
  })

  it('keeps the current page on a failed read and follows the opaque cursor on retry', async () => {
    vi.mocked(loadFailedDeliveriesServerFn)
      .mockRejectedValueOnce(new Error('Session expired'))
      .mockResolvedValueOnce({ items: [], nextCursor: null })
    render(<AdminFailedDeliveries initialPage={initialPage} />)
    fireEvent.click(screen.getByRole('button', { name: 'Older failures' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not load failed deliveries.'
    )
    expect(screen.getByText('dead_lettered')).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Older failures' }).hasAttribute('disabled')
      ).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: 'Older failures' }))
    await screen.findByText('No terminal webhook failures on this page.')
    expect(loadFailedDeliveriesServerFn).toHaveBeenLastCalledWith({
      data: { cursor: 'older-cursor' }
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Older failures' }).hasAttribute('disabled')
      ).toBe(true)
    )
  })

  it('shows a failed enqueue instead of claiming success', async () => {
    vi.mocked(replayFailedDeliveryServerFn).mockRejectedValue(
      new Error('Queue unavailable')
    )
    render(<AdminFailedDeliveries initialPage={initialPage} />)
    fireEvent.click(screen.getByRole('button', { name: 'Replay whd_terminal' }))
    expect(
      await screen.findByText(/Replay failed\. A pending copy may already exist\./)
    ).toBeTruthy()
    expect(screen.queryByText(/Queued as/)).toBeNull()
  })

  it('disables replay while enqueue is pending and permits retry after refusal', async () => {
    const response =
      deferred<Awaited<ReturnType<typeof replayFailedDeliveryServerFn>>>()
    vi.mocked(replayFailedDeliveryServerFn).mockReturnValue(response.promise)
    render(<AdminFailedDeliveries initialPage={initialPage} />)
    fireEvent.click(screen.getByRole('button', { name: 'Replay whd_terminal' }))
    expect(await screen.findByText('Queuing…')).toHaveProperty('disabled', true)
    expect(screen.queryByText(/Queued as/)).toBeNull()
    await act(async () => {
      response.resolve({ status: 'refused', reason: 'Endpoint is disabled' })
    })
    expect(screen.getByText('Endpoint is disabled')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Replay whd_terminal' })).toHaveProperty(
      'disabled',
      false
    )
  })

  it('keeps rows visible and disables both paging controls while reading', async () => {
    const response = deferred<FailedDeliveriesPayload>()
    vi.mocked(loadFailedDeliveriesServerFn).mockReturnValue(response.promise)
    render(<AdminFailedDeliveries initialPage={initialPage} />)
    fireEvent.click(screen.getByRole('button', { name: 'Older failures' }))
    expect(await screen.findByText('Loading failures…')).toBeTruthy()
    expect(screen.getByText('dead_lettered')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Older failures' })).toHaveProperty(
      'disabled',
      true
    )
    expect(screen.getByRole('button', { name: 'Refresh newest' })).toHaveProperty(
      'disabled',
      true
    )
    await act(async () => {
      response.resolve({ items: [], nextCursor: null })
    })
    expect(screen.getByText('No terminal webhook failures on this page.')).toBeTruthy()
  })
})
