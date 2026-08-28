import { Cause, Effect, Exit, Option } from 'effect'
import { causeMessage } from '@/lib/cause-message'

/**
 * Runs one server fn (or any promise), folding any failure — typed capability
 * error or raw rejection — into a displayable message instead of letting it
 * escape as an unhandled rejection.
 */
export async function callServerFn<A>(
  run: () => Promise<A>,
  fallback: string,
  describe: (cause: unknown) => string = (cause) => causeMessage(cause, fallback)
): Promise<{ ok: true; value: A } | { ok: false; message: string }> {
  const exit = await Effect.runPromiseExit(
    Effect.tryPromise({ try: run, catch: (cause) => describe(cause) })
  )
  if (Exit.isSuccess(exit)) {
    return { ok: true, value: exit.value }
  }
  return {
    ok: false,
    message: Option.getOrElse(Cause.findErrorOption(exit.cause), () => fallback)
  }
}
