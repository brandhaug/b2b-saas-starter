// Promise-native vendor boundary: test the SDK protocol and preserve rejected operations.
// oxlint-disable effect/noAsyncFunction, effect/noTestLifecycleHooks, effect/noGlobals
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { captureOperationalSnapshot, withCronMonitor } from './providers.ts'

// Failure modes: thrown failures must propagate,
// successful cron completion and zero snapshots must remain visible without credentials.
const output = vi.spyOn(console, 'log').mockImplementation(() => {})
const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
beforeEach(() => {
  vi.clearAllMocks()
})

describe('operator telemetry boundary', () => {
  it('sends failed and recovered completion check-ins while preserving the job failure', async () => {
    await expect(
      withCronMonitor('drill', () => Promise.reject(new Error('fault')))
    ).rejects.toThrow('fault')
    await withCronMonitor('drill', () => Promise.resolve())
    expect(output.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { event: 'cron.check_in', monitorSlug: 'drill', status: 'in_progress' },
      { event: 'cron.check_in', monitorSlug: 'drill', status: 'in_progress' },
      { event: 'cron.check_in', monitorSlug: 'drill', status: 'ok' }
    ])
    expect(errors.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { event: 'cron.check_in', monitorSlug: 'drill', status: 'error' }
    ])
  })

  it('leaves provider-free operations and results intact', async () => {
    const result = await withCronMonitor('drill', () => Promise.resolve('done'))
    await captureOperationalSnapshot({ failures: 0 })
    expect(result).toBe('done')
    expect(output).toHaveBeenLastCalledWith(
      JSON.stringify({
        event: 'operations.snapshot',
        service: 'background',
        values: { failures: 0 }
      })
    )
  })
})
