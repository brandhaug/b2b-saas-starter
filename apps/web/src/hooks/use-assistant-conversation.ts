import { useEffect, useReducer, useRef, useState } from 'react'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
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

  useEffect(() => {
    const observerId = ++epoch.current
    const key = ['assistant-conversation', actorId, workspaceSlug, conversationId]
    let disposed = false
    let socket: WebSocket | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let reconnectDelay = 1000
    dispatch({ type: 'start', observer: observerId, reconnecting: generation > 0 })

    function dispose() {
      if (disposed) {
        return
      }
      disposed = true
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      socket?.close()
      void client.cancelQueries({ queryKey: key, exact: true })
    }

    function deny(message: string) {
      dispose()
      client.setQueryData(key, null)
      dispatch({ type: 'deny', observer: observerId, message })
      onAccessLost?.()
    }

    async function load(cursor?: string): Promise<void> {
      if (disposed) {
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
            const result = await callConversation(() => ports.history({ data }))
            // Cancellation also protects the cache when the server transport cannot abort.
            if (disposed || signal.aborted) {
              return null
            }
            if (!result.ok) {
              if (result.reason === 'not_found' || result.reason === 'access') {
                deny(result.message)
                return null
              }
              // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- TanStack Query requires rejection; the capability result already contains safe localized UI copy and Effect must stay outside the browser bundle.
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
    void load()
    function connect() {
      if (disposed) {
        return
      }
      const url = new URL(
        `/api/assistant/${encodeURIComponent(conversationId)}/connect`,
        window.location.origin
      )
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const currentSocket = new WebSocket(url)
      socket = currentSocket
      let closed = false
      currentSocket.addEventListener('open', () => {
        if (disposed || closed) {
          return
        }
        reconnectDelay = 1000
        dispatch({ type: 'open', observer: observerId })
      })
      currentSocket.addEventListener('message', (event: MessageEvent<string>) => {
        if (disposed || closed) {
          return
        }
        const snapshot = readConversationSnapshot(event.data)
        if (snapshot) {
          client.setQueryData<ConversationHistory | null>(key, (current) =>
            mergeConversationHistory(current ?? null, snapshot, 'snapshot')
          )
        }
      })
      currentSocket.addEventListener('close', (event) => {
        if (disposed || closed) {
          return
        }
        closed = true
        if (event.code === 1008 || [4401, 4403, 4404].includes(event.code)) {
          deny(m.assistant_conversations_access_lost())
          return
        }
        dispatch({ type: 'close', observer: observerId })
        void load()
        timer = setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, 15_000)
      })
    }
    connect()
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
