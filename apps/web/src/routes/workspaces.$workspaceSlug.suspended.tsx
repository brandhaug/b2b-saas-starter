import { createFileRoute } from '@tanstack/react-router'

import { SuspendedWorkspaceRecovery } from '@/components/suspended-workspace-recovery'
import { pageTitle } from '@/components/page/page-title'
import { RoutePending } from '@/components/route-pending'
import { loadWorkspaceRecoveryServerFn } from '@/lib/server/workspace-suspension'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/workspaces/$workspaceSlug/suspended')({
  loader: ({ params }) =>
    loadWorkspaceRecoveryServerFn({ data: { workspaceSlug: params.workspaceSlug } }),
  pendingComponent: RoutePending,
  component: SuspendedWorkspaceRoute,
  head: ({ params }) => ({
    meta: [
      { title: pageTitle(m.workspace_suspended_description(), params.workspaceSlug) }
    ]
  })
})

function SuspendedWorkspaceRoute() {
  const data = Route.useLoaderData()
  const systemRole = Route.useRouteContext().session.user.role
  return (
    <SuspendedWorkspaceRecovery
      workspaceSlug={Route.useParams().workspaceSlug}
      data={data}
      systemRole={systemRole}
    />
  )
}
