import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { Effect, Exit, Fiber, Scope } from 'effect'

export type AuthRequest = {
  readonly signal: AbortSignal
  readonly current: () => boolean
  readonly win: () => void
}

function createRequestScope() {
  let active: {
    lifetime: Scope.Closeable
    kind: 'passive' | 'explicit' | 'won'
  } | null = null
  function cancel() {
    if (active !== null) {
      Effect.runFork(Scope.close(active.lifetime, Exit.void))
    }
    active = null
  }
  return {
    cancel,
    busy: () => active !== null && active.kind !== 'passive',
    acquire(passive: boolean) {
      if (active !== null && (active.kind !== 'passive' || passive)) {
        return null
      }
      cancel()
      const attempt: NonNullable<typeof active> = {
        lifetime: Scope.makeUnsafe(),
        kind: passive ? 'passive' : 'explicit'
      }
      active = attempt
      return {
        lifetime: attempt.lifetime,
        current: () => active === attempt && attempt.lifetime.state._tag !== 'Closed',
        win: () => {
          attempt.kind = 'won'
        },
        release: () => {
          Effect.runFork(Scope.close(attempt.lifetime, Exit.void))
          if (active === attempt && attempt.kind !== 'won') {
            active = null
          }
        }
      }
    }
  }
}

type RequestScope = ReturnType<typeof createRequestScope>
export const AuthRequestContext = createContext<RequestScope | null>(null)

export function useAuthRequestScope() {
  const router = useRouter()
  // oxlint-disable-next-line react/hook-use-state -- the request owner has the mounted screen's lifetime and is never replaced
  const [scope] = useState(createRequestScope)
  useEffect(() => {
    const unsubscribe = router.subscribe('onBeforeNavigate', () => scope.cancel())
    return () => {
      unsubscribe()
      scope.cancel()
    }
  }, [router, scope])
  return scope
}

type AuthRequestTask = (
  request: AuthRequest
) => Promise<string | null | undefined> | Promise<void>

/** Query owns network status; the lease fences callbacks and same-tick duplicates. */
export function useAuthRequest(failureMessage: string, ownScope?: RequestScope) {
  const inherited = useContext(AuthRequestContext)
  const local = useAuthRequestScope()
  const scope = ownScope ?? inherited ?? local
  const lifetime = useRef<Scope.Closeable | null>(null)
  useEffect(
    () => () => {
      if (lifetime.current !== null) {
        Effect.runFork(Scope.close(lifetime.current, Exit.void))
      }
    },
    []
  )
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- auth outcomes navigate through session gates; there is no cached resource to invalidate
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: async ({
      task,
      lease
    }: {
      task: AuthRequestTask
      lease: NonNullable<ReturnType<RequestScope['acquire']>>
    }) => {
      if (!lease.current()) {
        return null
      }
      const result = await Effect.runPromiseExit(
        Effect.tryPromise({
          try: async (signal) =>
            (await task({
              signal,
              current: () => lease.current() && !signal.aborted,
              win: lease.win
            })) ?? null,
          catch: () => failureMessage
        }).pipe(
          Effect.catch((error) => Effect.succeed(error)),
          Effect.map((message) => (lease.current() ? (message ?? null) : null)),
          Effect.forkIn(lease.lifetime, { startImmediately: true }),
          Effect.flatMap(Fiber.join)
        )
      )
      // Interruption settles Query state even when an SDK ignores its AbortSignal.
      return Exit.isSuccess(result) ? result.value : null
    }
  })
  async function run(task: AuthRequestTask, passive = false) {
    const lease = scope.acquire(passive)
    if (lease === null) {
      return
    }
    if (lifetime.current !== null) {
      Effect.runFork(Scope.close(lifetime.current, Exit.void))
    }
    lifetime.current = lease.lifetime
    await mutation.mutateAsync({ task, lease }).finally(lease.release)
  }
  return {
    run,
    busy: scope.busy,
    pending: mutation.isPending,
    error: mutation.data ?? null,
    reset: mutation.reset
  }
}
