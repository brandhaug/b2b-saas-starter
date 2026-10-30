import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { m } from '@b2b-saas-starter/i18n/messages'
import { useServerCall } from '@/hooks/use-server-call'
import { UiError, isStrongAuthenticationError } from '@/lib/ui-error'

/**
 * Write receipt or safe failure. A completed write keeps its receipt when its
 * callback or refresh fails, so callers do not repeat the write to refresh UI.
 */
export type ServerActionOutcome<A> =
  | { readonly ok: true; readonly value: A; readonly refreshError?: string }
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
  readonly result: A | undefined
  /** Clears settled feedback and receipts; cannot clear an in-flight mutation. */
  readonly reset: () => void
}

/**
 * One single-flight mutation per mounted owner. Query owns status and receipts;
 * the ref only excludes duplicate calls before React renders pending status.
 * identityKey changes invalidate callbacks from the previous entity. Query-owned
 * lists refresh in onSuccess; loader-owned reads use the default router refresh.
 */
export function useServerAction<I = void, A = void>(
  call: (input: I) => Promise<A>,
  {
    failureMessage,
    describeFailure,
    onSuccess,
    invalidate = true,
    identityKey
  }: {
    readonly failureMessage: string
    /** Turns a rejection into copy, when the fallback message is too blunt. */
    readonly describeFailure?: (cause: unknown) => string
    readonly onSuccess?: (value: A, input: I) => void | Promise<void>
    readonly invalidate?: boolean
    readonly identityKey?: string
  }
): ServerAction<I, A> {
  const router = useRouter()
  const callServerFn = useServerCall()
  const scope = useRef({ identityKey, epoch: 0 })
  const inFlight = useRef<Promise<ServerActionOutcome<A>> | null>(null)
  function checkedCall(input: I, current: () => boolean) {
    // oxlint-disable-next-line effect/noNewPromise -- client-side promise boundary also captures synchronous server-call failures without bundling Effect
    return Promise.resolve()
      .then(() => call(input))
      .catch(
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- rejected server calls cross the UI error boundary
        async (error: unknown) => {
          if (
            current() &&
            error instanceof UiError &&
            isStrongAuthenticationError(error)
          ) {
            await router.navigate({
              to: '/verify-authentication',
              search: { redirect: router.state.location.href, recent: 'true' }
            })
          }
          // oxlint-disable-next-line effect/noThrowStatement -- preserve the original rejection for callServerFn's error adapter
          throw error
        }
      )
  }
  const mutation = useMutation({
    // One-time receipts must leave the mutation cache when their observer goes away.
    gcTime: 0,
    mutationFn: async ({
      input,
      requestEpoch
    }: {
      readonly input: I
      readonly requestEpoch: number
      readonly identityKey: string | undefined
    }): Promise<ServerActionOutcome<A>> => {
      function current() {
        return requestEpoch === scope.current.epoch
      }
      const outcome =
        describeFailure === undefined
          ? await callServerFn(() => checkedCall(input, current), failureMessage)
          : await callServerFn(
              () => checkedCall(input, current),
              failureMessage,
              describeFailure
            )
      if (!current()) {
        return { ok: false, message: m.web_action_view_changed() }
      }
      if (!outcome.ok) {
        return outcome
      }
      // A failed callback or refresh must not turn a completed write into a retryable write failure.
      const refreshed = await callServerFn(async () => {
        await onSuccess?.(outcome.value, input)
        if (invalidate && current()) {
          await router.invalidate()
        }
      }, m.web_action_refresh_failed())
      if (!current()) {
        return { ok: false, message: m.web_action_view_changed() }
      }
      return refreshed.ok
        ? outcome
        : { ...outcome, refreshError: m.web_action_refresh_failed() }
    }
  })
  const resetMutation = mutation.reset
  useEffect(() => {
    scope.current = { identityKey, epoch: scope.current.epoch + 1 }
    inFlight.current = null
    resetMutation()
    return () => {
      scope.current.epoch += 1
    }
  }, [identityKey, resetMutation])

  function runAsync(input: I): Promise<ServerActionOutcome<A>> {
    if (inFlight.current !== null) {
      // oxlint-disable-next-line effect/noNewPromise -- Synchronous duplicate exclusion at the client mutation boundary.
      return Promise.resolve({ ok: false, message: m.web_action_in_progress() })
    }
    const pending = mutation
      .mutateAsync({ input, requestEpoch: scope.current.epoch, identityKey })
      .finally(() => {
        if (inFlight.current === pending) {
          inFlight.current = null
        }
      })
    inFlight.current = pending
    return pending
  }

  const current = mutation.variables?.identityKey === identityKey
  const outcome = current ? mutation.data : undefined
  const error =
    outcome?.ok === false ? outcome.message : (outcome?.refreshError ?? null)
  return {
    run: (input) => {
      void runAsync(input)
    },
    runAsync,
    pending: current && mutation.isPending,
    pendingInput: current && mutation.isPending ? mutation.variables.input : undefined,
    result: outcome?.ok ? outcome.value : undefined,
    error,
    reset: () => {
      if (inFlight.current === null) {
        mutation.reset()
      }
    }
  }
}
