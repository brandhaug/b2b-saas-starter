import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { useClipboard } from './use-clipboard'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}

function install(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  })
  return writeText
}

afterEach(() => vi.useRealTimers())

it('prevents same-tick duplicate writes and retries after failure', async () => {
  const pending = deferred()
  const write = install(
    vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
  )
  const { result } = renderHook(() => useClipboard('secret'))
  act(() => {
    void result.current.copy()
    void result.current.copy()
  })
  expect(write).toHaveBeenCalledTimes(1)
  expect(result.current.status).toBe('pending')
  await act(async () => pending.reject(new Error('denied')))
  expect(result.current.status).toBe('failed')
  await act(async () => result.current.copy())
  expect(result.current.status).toBe('copied')
})

it.each(['resolve', 'reject'] as const)(
  'ignores stale %s across replacement and return to the original value',
  async (settle) => {
    const old = deferred()
    const current = deferred()
    install(
      vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    )
    const { result, rerender } = renderHook(({ value }) => useClipboard(value), {
      initialProps: { value: 'A' }
    })
    act(() => {
      void result.current.copy()
    })
    rerender({ value: 'B' })
    expect(result.current.status).toBe('idle')
    rerender({ value: 'A' })
    act(() => {
      void result.current.copy()
    })
    await act(async () => {
      if (settle === 'resolve') {
        old.resolve()
      } else {
        old.reject(new Error('denied'))
      }
    })
    expect(result.current.status).toBe('pending')
    await act(async () => current.resolve())
    expect(result.current.status).toBe('copied')
  }
)

it('does not allocate feedback timers after unmount and clears existing timers', async () => {
  vi.useFakeTimers()
  const pending = deferred()
  install(vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined))
  const first = renderHook(() => useClipboard('A', { successDuration: 2000 }))
  act(() => {
    void first.result.current.copy()
  })
  first.unmount()
  await act(async () => pending.resolve())
  expect(vi.getTimerCount()).toBe(0)
  const second = renderHook(() => useClipboard('B', { successDuration: 2000 }))
  await act(async () => second.result.current.copy())
  expect(vi.getTimerCount()).toBe(1)
  second.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('clears old expiry before a new request and expires configured feedback', async () => {
  vi.useFakeTimers()
  const pending = deferred()
  install(vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(pending.promise))
  const { result } = renderHook(() =>
    useClipboard('A', { successDuration: 2000, failureDuration: 2000 })
  )
  await act(async () => result.current.copy())
  act(() => {
    void result.current.copy()
  })
  act(() => {
    vi.advanceTimersByTime(2000)
  })
  expect(result.current.status).toBe('pending')
  await act(async () => pending.reject(new Error('denied')))
  expect(result.current.status).toBe('failed')
  act(() => {
    vi.advanceTimersByTime(2000)
  })
  expect(result.current.status).toBe('idle')
})

it('handles unsupported clipboard and remains usable after StrictMode replay', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: undefined
  })
  const { result } = renderHook(() => useClipboard('A'), { wrapper: StrictMode })
  await act(async () => result.current.copy())
  expect(result.current.status).toBe('failed')
  const write = install()
  await act(async () => result.current.copy('timestamped A'))
  expect(write).toHaveBeenCalledWith('timestamped A')
  expect(result.current.status).toBe('copied')
})
