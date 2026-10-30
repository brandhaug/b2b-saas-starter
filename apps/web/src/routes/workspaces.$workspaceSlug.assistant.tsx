import {
  createConversationServerFn,
  listConversationsServerFn,
  conversationHistoryServerFn,
  sendConversationServerFn,
  retryConversationServerFn,
  stopConversationServerFn,
  deleteConversationServerFn,
  type ConversationPorts
} from '@/lib/server/assistant-conversations'
import { pickOptionalStrings } from '@/lib/utils'
import {
  createAssistantTaskServerFn,
  getAssistantTaskServerFn,
  approveAssistantTaskServerFn,
  cancelAssistantTaskServerFn
} from '@/lib/server/assistant-tasks'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { pageQueryOptions } from '@/lib/page-query'
import { pageTitle } from '@/components/page/page-title'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceAssistantPage } from '@/components/workspace-assistant-page'
import { askAssistantServerFn, loadAssistantPageServerFn } from '@/lib/server/assistant'
import { m } from '@b2b-saas-starter/i18n/messages'

const conversationPorts: ConversationPorts = {
  create: createConversationServerFn,
  list: listConversationsServerFn,
  history: conversationHistoryServerFn,
  send: sendConversationServerFn,
  retry: retryConversationServerFn,
  stop: stopConversationServerFn,
  remove: deleteConversationServerFn
}

async function listInvestigationTasks(workspaceSlug: string) {
  const page = await loadAssistantPageServerFn({ data: { workspaceSlug } })
  return page.investigations?.tasks ?? []
}

function assistantQuery(actorId: string, workspaceSlug: string) {
  return pageQueryOptions(['workspace-assistant', actorId, workspaceSlug], () =>
    loadAssistantPageServerFn({ data: { workspaceSlug } })
  )
}

export const Route = createFileRoute('/workspaces/$workspaceSlug/assistant')({
  validateSearch: (search) =>
    pickOptionalStrings(search, ['deliveryId', 'taskId', 'conversationId']),
  loader: async ({ params, context }) => {
    // The task list owns mutation results. Refresh through its query function
    // so cancellation by a newer mutation protects those results.
    // oxlint-disable-next-line effect/noNewPromise -- refresh independent page and task-list queries in parallel
    const [data] = await Promise.all([
      context.queryClient.query({
        ...assistantQuery(context.session.user.id, params.workspaceSlug),
        staleTime: 0
      }),
      context.queryClient.invalidateQueries({
        queryKey: [
          'assistant-investigation-tasks',
          context.session.user.id,
          params.workspaceSlug
        ],
        exact: true
      })
    ])
    return data
  },
  pendingComponent: RoutePending,
  component: WorkspaceAssistantRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle(m.public_meta_assistant(), params.workspaceSlug) }]
  })
})

/** Thin wrapper: hands the loader payload and the real server fn to the page
 * so tests render the page with plain props — no route tree, no mocked hooks. */
function WorkspaceAssistantRoute() {
  const { workspaceSlug } = Route.useParams()
  const { session } = Route.useRouteContext()
  const { data } = useSuspenseQuery(assistantQuery(session.user.id, workspaceSlug))
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <WorkspaceAssistantPage
      workspaceSlug={workspaceSlug}
      data={data}
      ask={askAssistantServerFn}
      persistent={{
        actorId: session.user.id,
        ports: conversationPorts,
        conversationId: search.conversationId,
        onSelectConversation: (conversationId) => {
          void navigate({ search: { ...search, conversationId } })
        }
      }}
      {...(search.deliveryId === undefined
        ? {}
        : { selectedDeliveryId: search.deliveryId })}
      {...(search.taskId === undefined ? {} : { selectedTaskId: search.taskId })}
      onSelectTask={(taskId) => {
        void navigate({ search: { ...search, taskId } })
      }}
      {...(data.investigations
        ? {
            investigation: {
              actorId: session.user.id,
              ...data.investigations,
              list: listInvestigationTasks,
              create: createAssistantTaskServerFn,
              get: getAssistantTaskServerFn,
              approve: approveAssistantTaskServerFn,
              cancel: cancelAssistantTaskServerFn
            }
          }
        : {})}
      systemRole={session.user.role}
    />
  )
}
