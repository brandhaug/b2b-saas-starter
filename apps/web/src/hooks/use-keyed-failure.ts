import { useState } from 'react'
import { type ServerActionOutcome } from './use-server-action'

/**
 * A failure pinned to the thing that produced it: the per-row pattern the
 * list panels render, where a mutation's failure lands on the row (or the
 * batch) that failed instead of in a lone alert at the panel foot.
 *
 * The key is whatever the caller pins failures to — a row id for the roster,
 * invitation, and webhook panels; the id batch for the notification feed's
 * mark-read. `runWith` takes the `useServerAction` call to await, so the
 * clear-on-settle sequence is written once instead of re-derived per panel.
 *
 * Clearing happens when a run **settles**, not when it starts: an in-flight
 * retry keeps the previous failure on the row (the reader still needs it
 * until the retry answers), a settled success clears it, and a settled
 * failure replaces it.
 */
export function useKeyedFailure<K>() {
  const [failure, setFailure] = useState<{
    readonly key: K
    readonly message: string
  } | null>(null)

  async function runWith<A>(
    key: K,
    run: () => Promise<ServerActionOutcome<A>>
  ): Promise<void> {
    const outcome = await run()
    if (outcome.ok) {
      setFailure(null)
    } else {
      setFailure({ key, message: outcome.message })
    }
  }

  return { failure, runWith }
}
