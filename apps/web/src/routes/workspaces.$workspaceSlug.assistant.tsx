import { createFileRoute } from '@tanstack/react-router'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceAssistantPage } from '@/components/workspace-assistant-page'
import { askAssistantServerFn, loadAssistantPage } from '@/lib/server/assistant'

export const Route = createFileRoute('/workspaces/$workspaceSlug/assistant')({
  loader: ({ params, context }) =>
    loadAssistantPage({
      workspaceSlug: params.workspaceSlug,
      userId: context.session.user.id
    }),
  pendingComponent: RoutePending,
  component: WorkspaceAssistantRoute
})

/** Thin wrapper: hands the loader payload and the real server fn to the page
 * so tests render the page with plain props — no route tree, no mocked hooks. */
function WorkspaceAssistantRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  return (
    <WorkspaceAssistantPage
      workspaceSlug={workspaceSlug}
      data={data}
      ask={askAssistantServerFn}
    />
  )
}
