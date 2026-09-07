// Promise-native vendor boundary: test the SDK protocol and preserve rejected operations.
// oxlint-disable effect/noAsyncFunction, effect/noTestLifecycleHooks
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  captureOperationalSnapshot,
  withCronMonitor,
  withHttpMonitor
} from './providers.ts'

const sentry = vi.hoisted(() => ({
  isEnabled: vi.fn(() => true),
  captureCheckIn: vi.fn<(input: Record<string, string>) => string>(() => 'check-in'),
  metrics: { count: vi.fn(), gauge: vi.fn() }
}))
vi.mock('@sentry/cloudflare', () => sentry)
beforeEach(() => {
  vi.clearAllMocks()
  sentry.isEnabled.mockReturnValue(true)
})

describe('operator telemetry boundary', () => {
  it('counts handled server errors, successful responses, and thrown failures in the same denominator', async () => {
    await withHttpMonitor('api', () =>
      Promise.resolve(new Response(null, { status: 503 }))
    )
    await withHttpMonitor('api', () =>
      Promise.resolve(new Response(null, { status: 404 }))
    )
    await expect(
      withHttpMonitor('api', () => Promise.reject(new Error('offline')))
    ).rejects.toThrow('offline')
    expect(sentry.metrics.count.mock.calls).toEqual([
      ['http.requests', 1, { attributes: { service: 'api', server_error: true } }],
      ['http.requests', 1, { attributes: { service: 'api', server_error: false } }],
      ['http.requests', 1, { attributes: { service: 'api', server_error: true } }]
    ])
  })

  it('sends failed and recovered completion check-ins while preserving the job failure', async () => {
    await expect(
      withCronMonitor('drill', () => Promise.reject(new Error('fault')))
    ).rejects.toThrow('fault')
    await withCronMonitor('drill', () => Promise.resolve())
    expect(sentry.captureCheckIn.mock.calls.map(([input]) => input)).toEqual([
      { monitorSlug: 'drill', status: 'in_progress' },
      { monitorSlug: 'drill', status: 'error', checkInId: 'check-in' },
      { monitorSlug: 'drill', status: 'in_progress' },
      { monitorSlug: 'drill', status: 'ok', checkInId: 'check-in' }
    ])
  })

  it('publishes a zero gauge after recovery', async () => {
    await captureOperationalSnapshot({ 'billing.overdue_workspaces': 1 })
    await captureOperationalSnapshot({ 'billing.overdue_workspaces': 0 })
    expect(sentry.metrics.gauge).toHaveBeenLastCalledWith(
      'billing.overdue_workspaces',
      0,
      { attributes: { service: 'background' } }
    )
  })

  it('leaves provider-free operations and results intact', async () => {
    sentry.isEnabled.mockReturnValue(false)
    const result = await withCronMonitor('drill', () => Promise.resolve('done'))
    await captureOperationalSnapshot({ failures: 2 })
    expect(result).toBe('done')
    expect(sentry.captureCheckIn).not.toHaveBeenCalled()
    expect(sentry.metrics.gauge).not.toHaveBeenCalled()
  })
})
