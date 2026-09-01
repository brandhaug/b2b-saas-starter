import { useMutation } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { callServerFn } from '@/lib/server-call'

/**
 * What one server-fn call reports back: the value on success, a displayable
 * message on failure. `callServerFn` folds every rejection into this shape, so
 * the mutation itself never rejects and there is no error channel to throw on.
 */
export type ServerActionOutcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly message: string }

export type ServerAction<I, A> = {
  /** Fires the action. Safe to call straight from an event handler. */
  readonly run: (input: I) => void
  /** Fires the action and resolves with its outcome, for sequenced callers. */
  readonly runAsync: (input: I) => Promise<ServerActionOutcome<A>>
  readonly pending: boolean
  /** The input currently in flight, so a list can busy-mark just its own row. */
  readonly pendingInput: I | undefined
  readonly error: string | null
  /** Clears a displayed failure without firing anything. */
  readonly reset: () => void
}

/**
 * One mutation, as a hook: busy flag, failure message, and a loader refresh on
 * success. Panels used to hand-roll this trio — an error string, a busy flag or
 * id, and an async function that cleared, set, called, unset and branched — ten
 * times over, with drift. `router.invalidate()` runs on success unless
 * `invalidate: false`, because the loader, not local state, owns the list.
 */
export function useServerAction<I = void, A = void>(
  call: (input: I) => Promise<A>,
  {
    failureMessage,
    describeFailure,
    onSuccess,
    invalidate = true
  }: {
    readonly failureMessage: string
    /** Turns a rejection into copy, when the fallback message is too blunt. */
    readonly describeFailure?: (cause: unknown) => string
    readonly onSuccess?: (value: A, input: I) => void | Promise<void>
    readonly invalidate?: boolean
  }
): ServerAction<I, A> {
  const router = useRouter()
  const mutation = useMutation({
    mutationFn: (input: I) =>
      describeFailure === undefined
        ? callServerFn(() => call(input), failureMessage)
        : callServerFn(() => call(input), failureMessage, describeFailure),
    onSuccess: async (outcome: ServerActionOutcome<A>, input: I) => {
      if (!outcome.ok) {
        return
      }
      await onSuccess?.(outcome.value, input)
      if (invalidate) {
        await router.invalidate()
      }
    }
  })

  const outcome = mutation.data
  return {
    run: (input) => {
      mutation.mutate(input)
    },
    runAsync: (input) => mutation.mutateAsync(input),
    pending: mutation.isPending,
    pendingInput: mutation.isPending ? mutation.variables : undefined,
    error: outcome !== undefined && !outcome.ok ? outcome.message : null,
    reset: () => {
      mutation.reset()
    }
  }
}
