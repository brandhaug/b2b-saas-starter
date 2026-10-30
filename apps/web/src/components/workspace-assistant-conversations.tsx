import { useCallback } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useServerAction } from '@/hooks/use-server-action'
import { type ConversationPorts } from '@/lib/server/assistant-conversations'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/page/panel'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Spinner } from '@/components/ui/spinner'
import { callConversation } from '@/lib/assistant-conversation-call'
import { ConversationDetail } from './workspace-assistant-conversations-detail'
import { m } from '@b2b-saas-starter/i18n/messages'

export type PersistentAssistant = {
  readonly actorId?: string
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
  const queryClient = useQueryClient()
  const firstPage: string | undefined = undefined
  const directory = useInfiniteQuery({
    queryKey: ['assistant-directory', persistent.actorId, workspaceSlug],
    initialPageParam: firstPage,
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const data = { workspaceSlug }
      if (pageParam !== undefined) {
        Object.assign(data, { cursor: pageParam })
      }
      const result = await callConversation(() => ports.list({ data }))
      if (!result.ok) {
        // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- Query must reject failed pages to retain the previous cursor; capability copy is already safe for the browser.
        throw new Error(result.message)
      }
      return result.value
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false
  })
  const conversations = [
    ...new Map(
      directory.data?.pages.flatMap((page) =>
        page.items.map((row) => [row.id, row] as const)
      )
    ).values()
  ]
  const loading = directory.isFetching
  function refresh() {
    return queryClient.invalidateQueries({
      queryKey: ['assistant-directory', persistent.actorId, workspaceSlug]
    })
  }
  const createAction = useServerAction(
    () => callConversation(() => ports.create({ data: { workspaceSlug } })),
    {
      failureMessage: m.assistant_unreachable(),
      identityKey: `${persistent.actorId ?? ''}:${workspaceSlug}:${conversationId ?? ''}`,
      invalidate: false,
      onSuccess: async (result) => {
        if (result.ok) {
          onSelectConversation(result.value.id)
          await refresh()
        }
      }
    }
  )
  const creating = createAction.pending
  const error =
    createAction.error ??
    (createAction.result?.ok === false ? createAction.result.message : null) ??
    directory.error?.message ??
    null
  // oxlint-disable-next-line react-doctor/react-compiler-no-manual-memoization -- Stable observer callback avoids reconnecting the socket when a directory read completes.
  const accessLost = useCallback(() => {
    void queryClient.resetQueries({
      queryKey: ['assistant-directory', persistent.actorId, workspaceSlug]
    })
  }, [queryClient, workspaceSlug, persistent.actorId])
  return (
    <Panel
      title={m.assistant_conversations_title()}
      description={m.assistant_conversations_private()}
      actions={
        <Button
          variant="outline"
          disabled={creating}
          onClick={() => createAction.run(undefined)}
        >
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
          {directory.hasNextPage ? (
            <Button
              variant="ghost"
              disabled={loading}
              onClick={() => void directory.fetchNextPage({ cancelRefetch: false })}
            >
              {m.assistant_conversations_more()}
            </Button>
          ) : null}
        </nav>
        {conversationId ? (
          <ConversationDetail
            actorId={persistent.actorId}
            key={`${workspaceSlug}:${conversationId}`}
            workspaceSlug={workspaceSlug}
            conversationId={conversationId}
            configured={configured}
            taskId={taskId}
            taskIds={taskIds}
            ports={ports}
            onSelectTask={onSelectTask}
            onAccessLost={accessLost}
            onChanged={refresh}
            onDeleted={() => {
              onSelectConversation(undefined)
              return refresh()
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
