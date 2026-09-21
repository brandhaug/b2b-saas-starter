import { useCallback, useEffect, useRef, useState } from 'react'
import { type ConversationSummary } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { type ConversationPorts } from '@/lib/server/assistant-conversations'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/page/panel'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Spinner } from '@/components/ui/spinner'
import { callConversation } from '@/lib/assistant-conversation-call'
import { ConversationDetail } from './workspace-assistant-conversations-detail'
import { m } from '@b2b-saas-starter/i18n/messages'

export type PersistentAssistant = {
  readonly ports: ConversationPorts
  readonly conversationId?: string | undefined
  readonly onSelectConversation: (id: string | undefined) => void
}

export function WorkspaceAssistantConversations({
  workspaceSlug,
  configured,
  taskId,
  taskIds,
  onSelectTask,
  persistent
}: {
  readonly workspaceSlug: string
  readonly configured: boolean
  readonly taskId?: string | undefined
  readonly taskIds: ReadonlyArray<string>
  readonly onSelectTask: (id: string) => void
  readonly persistent: PersistentAssistant
}) {
  const { ports, conversationId, onSelectConversation } = persistent
  const [conversations, setConversations] = useState<
    ReadonlyArray<ConversationSummary>
  >([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const listEpoch = useRef(0)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // oxlint-disable-next-line react-doctor/react-compiler-no-manual-memoization -- Stable loader identity bounds the initial external server read to workspace changes.
  const load = useCallback(
    async (cursor?: string) => {
      const requestEpoch = ++listEpoch.current
      setLoading(true)
      const data = { workspaceSlug }
      if (cursor !== undefined) {
        Object.assign(data, { cursor })
      }
      const result = await callConversation(() => ports.list({ data }))
      if (requestEpoch !== listEpoch.current) {
        return
      }
      // oxlint-disable-next-line react-doctor/no-loading-flag-reset-outside-finally -- callConversation folds transport rejections into a result and never rejects.
      setLoading(false)
      if (!result.ok) {
        setError(result.message)
        setConversations([])
        return
      }
      const page = result.value
      setError(null)
      setNextCursor(page.nextCursor)
      setConversations((current) => {
        if (cursor === undefined) {
          return page.items
        }
        const rows = new Map(current.map((row) => [row.id, row]))
        for (const row of page.items) {
          rows.set(row.id, row)
        }
        return [...rows.values()]
      })
    },
    [ports, workspaceSlug]
  )
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Initial synchronization with the server conversation directory.
    void load()
  }, [load])
  // oxlint-disable-next-line react-doctor/react-compiler-no-manual-memoization -- Stable observer callback avoids reconnecting the socket when a directory read completes.
  const accessLost = useCallback(() => {
    setConversations([])
    setNextCursor(null)
    void load()
  }, [load])
  async function create() {
    setCreating(true)
    const result = await callConversation(() =>
      ports.create({ data: { workspaceSlug } })
    )
    setCreating(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onSelectConversation(result.value.id)
    await load()
  }
  return (
    <Panel
      title={m.assistant_conversations_title()}
      description={m.assistant_conversations_private()}
      actions={
        <Button variant="outline" disabled={creating} onClick={() => void create()}>
          {creating ? <Spinner data-icon="inline-start" /> : null}
          {m.assistant_conversations_new()}
        </Button>
      }
    >
      <ActionFeedback error={error} />
      <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)]">
        <nav
          aria-label={m.assistant_conversations_title()}
          className="grid content-start gap-2 border-b border-border pb-4 md:border-r md:border-b-0 md:pr-4 md:pb-0"
        >
          {loading && conversations.length === 0 ? <Spinner /> : null}
          {conversations.map((conversation) => (
            <Button
              key={conversation.id}
              variant={conversation.id === conversationId ? 'secondary' : 'ghost'}
              className="h-auto min-h-11 justify-start py-2 text-left whitespace-normal"
              aria-current={conversation.id === conversationId ? 'page' : undefined}
              onClick={() => onSelectConversation(conversation.id)}
            >
              {conversation.title ?? m.assistant_conversations_untitled()}
            </Button>
          ))}
          {!loading && conversations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {m.assistant_conversations_empty()}
            </p>
          ) : null}
          {nextCursor ? (
            <Button
              variant="ghost"
              disabled={loading}
              onClick={() => void load(nextCursor)}
            >
              {m.assistant_conversations_more()}
            </Button>
          ) : null}
        </nav>
        {conversationId ? (
          <ConversationDetail
            key={conversationId}
            workspaceSlug={workspaceSlug}
            conversationId={conversationId}
            configured={configured}
            taskId={taskId}
            taskIds={taskIds}
            ports={ports}
            onSelectTask={onSelectTask}
            onAccessLost={accessLost}
            onChanged={() => void load()}
            onDeleted={() => {
              onSelectConversation(undefined)
              void load()
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {m.assistant_conversations_choose()}
          </p>
        )}
      </div>
    </Panel>
  )
}
