import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
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
  component: WorkspaceAssistantRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle('AI assistant', params.workspaceSlug) }]
  })
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
      systemRole={Route.useRouteContext().session.user.role}
    />
  )
}
