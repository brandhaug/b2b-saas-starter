import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { useKeyedFailure } from './use-keyed-failure'
import { type ServerActionOutcome } from './use-server-action'

/**
 * The hook's contract is its clear timing, not its wiring: a failure stays
 * pinned to its key while a retry is in flight, disappears when that retry
 * settles successfully, and is replaced when it settles with a failure.
 * Each test drives `runWith` with a deferred promise so every phase is
 * asserted at its own settle point — a hook that cleared on *start* (the
 * behavior this replaces) fails the in-flight assertion.
 */

/** A run whose outcome is decided by the test, at the test's pace. */
function deferredOutcome<A>() {
  let settle!: (outcome: ServerActionOutcome<A>) => void
  const promise = new Promise<ServerActionOutcome<A>>((resolve) => {
    settle = resolve
  })
  return {
    settle,
    run: (): Promise<ServerActionOutcome<A>> => promise
  }
}

/** Awaits `runWith` inside act without the void-expression dance. */
async function settleAct(pending: Promise<void>): Promise<void> {
  await act(async () => {
    await pending
  })
}

describe('useKeyedFailure', () => {
  it('keeps the previous failure visible while the next run is in flight', async () => {
    const first = deferredOutcome<null>()
    const second = deferredOutcome<null>()
    const { result } = renderHook(() => useKeyedFailure<string>())

    let settled = Promise.resolve()
    act(() => {
      settled = result.current.runWith('row-1', first.run)
    })
    first.settle({ ok: false, message: 'rename failed' })
    await settleAct(settled)
    expect(result.current.failure).toEqual({ key: 'row-1', message: 'rename failed' })

    // The retry is in flight; the row keeps its failure until it settles.
    let retry = Promise.resolve()
    act(() => {
      retry = result.current.runWith('row-1', second.run)
    })
    expect(result.current.failure).toEqual({ key: 'row-1', message: 'rename failed' })

    second.settle({ ok: true, value: null })
    await settleAct(retry)
    await waitFor(() => expect(result.current.failure).toBeNull())
  })

  it('replaces the failure with the settling run’s own key and message', async () => {
    const run = deferredOutcome<null>()
    const { result } = renderHook(() => useKeyedFailure<string>())

    let settled = Promise.resolve()
    act(() => {
      settled = result.current.runWith('row-2', run.run)
    })
    run.settle({ ok: false, message: 'remove failed' })
    await settleAct(settled)
    expect(result.current.failure).toEqual({ key: 'row-2', message: 'remove failed' })
  })

  it('starts with no failure', () => {
    const { result } = renderHook(() => useKeyedFailure<string>())
    expect(result.current.failure).toBeNull()
  })

  it('clears once a run settles successfully', async () => {
    const run = deferredOutcome<number>()
    const { result } = renderHook(() => useKeyedFailure<string>())
    let settled = Promise.resolve()
    act(() => {
      settled = result.current.runWith('k', run.run)
    })
    run.settle({ ok: true, value: 1 })
    await settleAct(settled)
    expect(result.current.failure).toBeNull()
  })
})
