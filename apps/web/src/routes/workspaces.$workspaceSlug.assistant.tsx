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

export const Route = createFileRoute('/workspaces/$workspaceSlug/assistant')({
  validateSearch: (search) =>
    pickOptionalStrings(search, ['deliveryId', 'taskId', 'conversationId']),
  loader: ({ params }) =>
    loadAssistantPageServerFn({
      data: { workspaceSlug: params.workspaceSlug }
    }),
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
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <WorkspaceAssistantPage
      workspaceSlug={workspaceSlug}
      data={data}
      ask={askAssistantServerFn}
      persistent={{
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
              ...data.investigations,
              create: createAssistantTaskServerFn,
              get: getAssistantTaskServerFn,
              approve: approveAssistantTaskServerFn,
              cancel: cancelAssistantTaskServerFn
            }
          }
        : {})}
      systemRole={Route.useRouteContext().session.user.role}
    />
  )
}
