import { useCallback, useEffect, useRef, useState } from 'react'
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

/** One observing tab. Unmount and reconnect never send Stop or another question. */
export function useAssistantConversation(
  workspaceSlug: string,
  conversationId: string,
  ports: ConversationPorts,
  onAccessLost?: () => void
) {
  const [history, setHistory] = useState<ConversationHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [generation, setGeneration] = useState(0)
  const [connection, setConnection] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'denied'
  >('connecting')
  const alive = useRef(true)
  const epoch = useRef(0)
  const denied = useRef(false)
  // oxlint-disable-next-line react-doctor/react-compiler-no-manual-memoization -- Stable identity prevents resetting a live external socket subscription on each streamed update.
  const load = useCallback(
    async (cursor?: string) => {
      const requestEpoch = epoch.current
      setLoading(true)
      const data = { workspaceSlug, conversationId }
      if (cursor !== undefined) {
        Object.assign(data, { cursor })
      }
      const result = await callConversation(() => ports.history({ data }))
      if (!alive.current || requestEpoch !== epoch.current) {
        return
      }
      // oxlint-disable-next-line react-doctor/no-loading-flag-reset-outside-finally -- callConversation folds transport rejections into a result and never rejects.
      setLoading(false)
      if (!result.ok) {
        setError(result.message)
        if (result.reason === 'not_found' || result.reason === 'access') {
          denied.current = true
          epoch.current += 1
          setConnection('denied')
          setHistory(null)
          onAccessLost?.()
        }
        return
      }
      denied.current = false
      setError(null)
      const incoming = result.value
      setHistory((current) =>
        mergeConversationHistory(
          current,
          incoming,
          cursor === undefined ? 'snapshot' : 'page'
        )
      )
    },
    [workspaceSlug, conversationId, ports, onAccessLost]
  )

  useEffect(() => {
    alive.current = true
    const observerEpoch = ++epoch.current
    denied.current = false
    // oxlint-disable-next-line react/set-state-in-effect -- Synchronizes React with a newly established external observer.
    setConnection(generation === 0 ? 'connecting' : 'reconnecting')
    void load()
    let socket: WebSocket | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let reconnectDelay = 1000
    function connect() {
      if (!alive.current || epoch.current !== observerEpoch || denied.current) {
        return
      }
      const url = new URL(
        `/api/assistant/${encodeURIComponent(conversationId)}/connect`,
        window.location.origin
      )
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(url)
      socket.addEventListener('open', () => {
        if (!alive.current || epoch.current !== observerEpoch) {
          return
        }
        reconnectDelay = 1000
        setConnection('connected')
      })
      socket.addEventListener('message', (event: MessageEvent<string>) => {
        const snapshot = readConversationSnapshot(event.data)
        if (
          snapshot &&
          alive.current &&
          epoch.current === observerEpoch &&
          !denied.current
        ) {
          setHistory((current) =>
            mergeConversationHistory(current, snapshot, 'snapshot')
          )
        }
      })
      socket.addEventListener('close', (event) => {
        if (!alive.current || epoch.current !== observerEpoch) {
          return
        }
        if (event.code === 1008 || [4401, 4403, 4404].includes(event.code)) {
          denied.current = true
          epoch.current += 1
          setHistory(null)
          setConnection('denied')
          setError(m.assistant_conversations_access_lost())
          onAccessLost?.()
          return
        }
        setConnection('reconnecting')
        void load()
        timer = setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, 15_000)
      })
    }
    connect()
    return () => {
      alive.current = false
      epoch.current += 1
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      socket?.close()
    }
  }, [conversationId, load, generation, onAccessLost])

  return {
    history,
    error,
    loading,
    connection,
    reconnect: () => setGeneration((value) => value + 1),
    refresh: load,
    loadOlder: () => (history?.nextCursor ? load(history.nextCursor) : undefined)
  }
}
