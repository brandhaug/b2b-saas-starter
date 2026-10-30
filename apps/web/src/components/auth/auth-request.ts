import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

export type AuthRequest = {
  readonly signal: AbortSignal
  readonly current: () => boolean
  readonly win: () => void
}

function createRequestScope() {
  let active: {
    controller: AbortController
    kind: 'passive' | 'explicit' | 'won'
  } | null = null
  function cancel() {
    active?.controller.abort()
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
        controller: new AbortController(),
        kind: passive ? 'passive' : 'explicit'
      }
      active = attempt
      return {
        signal: attempt.controller.signal,
        current: () => active === attempt && !attempt.controller.signal.aborted,
        win: () => {
          attempt.kind = 'won'
        },
        release: () => {
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
  const lifetime = useRef<AbortController | null>(null)
  useEffect(() => () => lifetime.current?.abort(), [])
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- auth outcomes navigate through session gates; there is no cached resource to invalidate
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: async ({
      task,
      request
    }: {
      task: AuthRequestTask
      request: AuthRequest
    }) => {
      if (!request.current()) {
        return null
      }
      return task(request).then(
        (error) => (request.current() ? (error ?? null) : null),
        () => (request.current() ? failureMessage : null)
      )
    }
  })
  async function run(task: AuthRequestTask, passive = false) {
    const lease = scope.acquire(passive)
    if (lease === null) {
      return
    }
    const controller = new AbortController()
    lifetime.current?.abort()
    lifetime.current = controller
    function abort() {
      controller.abort()
    }
    lease.signal.addEventListener('abort', abort, { once: true })
    const request: AuthRequest = {
      signal: controller.signal,
      current: () => lease.current() && !controller.signal.aborted,
      win: lease.win
    }
    await mutation.mutateAsync({ task, request }).finally(() => {
      lease.signal.removeEventListener('abort', abort)
      lease.release()
    })
  }
  return {
    run,
    busy: scope.busy,
    pending: mutation.isPending,
    error: mutation.data ?? null,
    reset: mutation.reset
  }
}
