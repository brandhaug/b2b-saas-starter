import { useEffect, useReducer, useRef, useState } from 'react'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import ReconnectingWebSocket from 'partysocket/ws'
import { Effect, Exit, Fiber, Scope } from 'effect'
import {
  type ConversationPorts,
  type ConversationHistory
} from '@/lib/server/assistant-conversations'
import { callConversation } from '@/lib/assistant-conversation-call'
import {
  mergeConversationHistory,
  readConversationSnapshot
} from '@/lib/assistant-conversation-stream'
import { m } from '@b2b-saas-starter/i18n/messages'

type Connection =
  | {
      readonly status: 'connecting' | 'connected' | 'reconnecting'
      readonly observer: number
    }
  | { readonly status: 'denied'; readonly observer: number; readonly message: string }

type ConnectionEvent =
  | {
      readonly type: 'start'
      readonly observer: number
      readonly reconnecting: boolean
    }
  | { readonly type: 'open' | 'close'; readonly observer: number }
  | { readonly type: 'deny'; readonly observer: number; readonly message: string }

function transition(state: Connection, event: ConnectionEvent): Connection {
  if (event.type === 'start') {
    return {
      observer: event.observer,
      status: event.reconnecting ? 'reconnecting' : 'connecting'
    }
  }
  if (event.observer !== state.observer || state.status === 'denied') {
    return state
  }
  if (event.type === 'deny') {
    return { status: 'denied', observer: event.observer, message: event.message }
  }
  return {
    observer: event.observer,
    status: event.type === 'open' ? 'connected' : 'reconnecting'
  }
}

/** One observing tab. Unmount and reconnect never send Stop or another question. */
export function useAssistantConversation(
  workspaceSlug: string,
  conversationId: string,
  ports: ConversationPorts,
  onAccessLost?: () => void,
  actorId?: string
) {
  const client = useQueryClient()
  const queryKey = ['assistant-conversation', actorId, workspaceSlug, conversationId]
  const historyQuery = useQuery<ConversationHistory | null>({
    queryKey,
    queryFn: skipToken,
    gcTime: 0
  })
  const [connection, dispatch] = useReducer(transition, {
    status: 'connecting',
    observer: 0
  })
  const [generation, setGeneration] = useState(0)
  const epoch = useRef(0)
  const observer = useRef<{
    readonly actorId: string | undefined
    readonly workspaceSlug: string
    readonly conversationId: string
    readonly load: (cursor?: string) => Promise<void>
  } | null>(null)

  // oxlint-disable-next-line react-doctor/effect-needs-cleanup -- the returned cleanup closes the Effect scope, whose finalizer removes every socket listener
  useEffect(() => {
    const observerId = ++epoch.current
    const key = ['assistant-conversation', actorId, workspaceSlug, conversationId]
    // One scope per identity/selection. Closing fences callbacks immediately and
    // interrupts reads even when the server-function Promise ignores cancellation.
    const lifetime = Scope.makeUnsafe()
    dispatch({ type: 'start', observer: observerId, reconnecting: generation > 0 })

    function dispose() {
      Effect.runFork(Scope.close(lifetime, Exit.void))
    }

    function deny(message: string) {
      dispose()
      client.setQueryData(key, null)
      dispatch({ type: 'deny', observer: observerId, message })
      onAccessLost?.()
    }

    async function load(cursor?: string): Promise<void> {
      if (lifetime.state._tag === 'Closed') {
        return
      }
      return client
        .query({
          queryKey: key,
          staleTime: 0,
          retry: false,
          gcTime: 0,
          queryFn: async ({ signal }): Promise<ConversationHistory | null> => {
            const data = { workspaceSlug, conversationId }
            if (cursor !== undefined) {
              Object.assign(data, { cursor })
            }
            const result = await Effect.runPromise(
              Effect.promise(() =>
                callConversation(() => ports.history({ data }))
              ).pipe(
                Effect.forkIn(lifetime),
                Effect.flatMap((fiber) =>
                  Fiber.join(fiber).pipe(Effect.ensuring(Fiber.interrupt(fiber)))
                )
              ),
              { signal }
            )
            // Cancellation also protects the cache when the server transport cannot abort.
            if (lifetime.state._tag === 'Closed' || signal.aborted) {
              return null
            }
            if (!result.ok) {
              if (result.reason === 'not_found' || result.reason === 'access') {
                deny(result.message)
                return null
              }
              // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- TanStack Query requires rejection; the capability result already contains safe localized UI copy.
              throw new Error(result.message)
            }
            const current = client.getQueryData<ConversationHistory | null>(key) ?? null
            if (cursor !== undefined && current?.nextCursor !== cursor) {
              return current
            }
            return mergeConversationHistory(
              current,
              result.value,
              cursor === undefined ? 'snapshot' : 'page'
            )
          }
        })
        .then(
          () => undefined,
          () => undefined
        )
    }

    observer.current = { actorId, workspaceSlug, conversationId, load }
    const url = new URL(
      `/api/assistant/${encodeURIComponent(conversationId)}/connect`,
      window.location.origin
    )
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new ReconnectingWebSocket(url.href, [], {
      maxEnqueuedMessages: 0,
      minReconnectionDelay: 1000,
      maxReconnectionDelay: 15_000,
      reconnectionDelayGrowFactor: 2,
      connectionTimeout: 10_000,
      shouldReconnectOnClose: (event) => ![1008, 4401, 4403, 4404].includes(event.code)
    })
    function onOpen() {
      if (lifetime.state._tag === 'Closed') {
        return
      }
      dispatch({ type: 'open', observer: observerId })
    }
    function onMessage(event: MessageEvent<string>) {
      if (lifetime.state._tag === 'Closed') {
        return
      }
      const snapshot = readConversationSnapshot(event.data)
      if (snapshot) {
        client.setQueryData<ConversationHistory | null>(key, (current) =>
          mergeConversationHistory(current ?? null, snapshot, 'snapshot')
        )
      }
    }
    function onClose(event: CloseEvent) {
      if (lifetime.state._tag === 'Closed') {
        return
      }
      if (event.code === 1008 || [4401, 4403, 4404].includes(event.code)) {
        deny(m.assistant_conversations_access_lost())
        return
      }
      dispatch({ type: 'close', observer: observerId })
      void load()
    }
    Effect.runSync(
      Scope.addFinalizer(
        lifetime,
        Effect.sync(() => {
          socket.removeEventListener('open', onOpen)
          socket.removeEventListener('message', onMessage)
          socket.removeEventListener('close', onClose)
          socket.close()
          void client.cancelQueries({ queryKey: key, exact: true })
        })
      )
    )
    socket.addEventListener('open', onOpen)
    socket.addEventListener('message', onMessage)
    socket.addEventListener('close', onClose)
    void load()
    return () => {
      dispose()
      observer.current = null
      client.removeQueries({ queryKey: key, exact: true })
    }
  }, [workspaceSlug, conversationId, ports, generation, onAccessLost, client, actorId])

  async function refresh(cursor?: string) {
    const current = observer.current
    if (
      current?.actorId !== actorId ||
      current?.workspaceSlug !== workspaceSlug ||
      current.conversationId !== conversationId
    ) {
      return
    }
    return current.load(cursor)
  }
  const denied = connection.status === 'denied'
  const history = denied ? null : (historyQuery.data ?? null)
  return {
    history,
    error: denied ? connection.message : (historyQuery.error?.message ?? null),
    loading: !denied && (historyQuery.isFetching || historyQuery.isPending),
    connection: connection.status,
    reconnect: () => setGeneration((value) => value + 1),
    refresh,
    loadOlder: () => (history?.nextCursor ? refresh(history.nextCursor) : undefined)
  }
}
