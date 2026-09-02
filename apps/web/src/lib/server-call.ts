import { causeMessage } from '@/lib/cause-message'

/**
 * Runs one server fn (or any promise), folding any failure — typed capability
 * error or raw rejection — into a displayable message instead of letting it
 * escape as an unhandled rejection. The returned promise never rejects; that
 * is the whole contract `useServerAction` and the forms are built on.
 *
 * Deliberately plain promise plumbing. Lifting the call into `Effect.tryPromise`
 * only to fold the exit back out added nothing an `onRejected` handler does not
 * do, and this module ships to the browser with every form that imports it.
 *
 * `Promise.resolve().then(run)` rather than `run().then(...)`: a `run` that
 * throws synchronously must land on the rejection handler like any other
 * failure, which is what the Effect boundary used to buy.
 */
export function callServerFn<A>(
  run: () => Promise<A>,
  fallback: string,
  describe: (cause: unknown) => string = (cause) => causeMessage(cause, fallback)
): Promise<{ ok: true; value: A } | { ok: false; message: string }> {
  // oxlint-disable-next-line effect/noNewPromise -- folding a promise boundary IS this function; the Effect wrapper it replaced only unfolded the exit again, and shipped `effect` to the browser to do it
  return Promise.resolve()
    .then(run)
    .then(
      (value) => ({ ok: true, value }),
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected promise's value is `unknown` by construction; `describe` (default `causeMessage`) is the parse step, and there is no schema that could narrow it first
      (error: unknown) => ({ ok: false, message: describe(error) })
    )
}
