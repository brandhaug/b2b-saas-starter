import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { pageQueryOptions } from '@/lib/page-query'

import { SuspendedWorkspaceRecovery } from '@/components/suspended-workspace-recovery'
import { pageTitle } from '@/components/page/page-title'
import { RoutePending } from '@/components/route-pending'
import { loadWorkspaceRecoveryServerFn } from '@/lib/server/workspace-suspension'
import { m } from '@b2b-saas-starter/i18n/messages'

function recoveryQuery(actorId: string, workspaceSlug: string) {
  return pageQueryOptions(['workspace-recovery', actorId, workspaceSlug], () =>
    loadWorkspaceRecoveryServerFn({ data: { workspaceSlug } })
  )
}

export const Route = createFileRoute('/workspaces/$workspaceSlug/suspended')({
  loader: ({ params, context }) =>
    context.queryClient.query({
      ...recoveryQuery(context.session.user.id, params.workspaceSlug),
      staleTime: 0
    }),
  pendingComponent: RoutePending,
  component: SuspendedWorkspaceRoute,
  head: ({ params }) => ({
    meta: [
      { title: pageTitle(m.workspace_suspended_description(), params.workspaceSlug) }
    ]
  })
})

function SuspendedWorkspaceRoute() {
  const { data } = useSuspenseQuery(
    recoveryQuery(
      Route.useRouteContext().session.user.id,
      Route.useParams().workspaceSlug
    )
  )
  const systemRole = Route.useRouteContext().session.user.role
  return (
    <SuspendedWorkspaceRecovery
      workspaceSlug={Route.useParams().workspaceSlug}
      data={data}
      systemRole={systemRole}
    />
  )
}
