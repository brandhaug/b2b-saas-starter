import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceDashboardPage } from '@/routes/workspaces.$workspaceSlug.index'
import {
  type ListNotifications,
  type NotificationPreview
} from '@/components/live-notifications'
import { pageTitle } from '@/components/page/page-title'
import { RoutePending } from '@/components/route-pending'
import { type WorkspaceDashboardPayload } from '@/lib/server/workspace-dashboard'
import { loadDemoWorkspace } from '@/lib/server/demo-showcase'

export const Route = createFileRoute('/demo/$workspaceSlug')({
  // The same actorless, read-only read the homepage strip uses: the demo
  // persona is a plain member, so the payload carries only what
  // `notification:read` reaches — the owner segments arrive as `null` because
  // the loader never reads them, exactly as the permission shape demands. An
  // unknown workspace still 404s through the shared failure mapping.
  loader: ({ params }) => loadDemoWorkspace(params.workspaceSlug),
  pendingComponent: RoutePending,
  component: DemoWorkspaceRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle('Live demo', params.workspaceSlug) }]
  })
})

function DemoWorkspaceRoute() {
  const data = Route.useLoaderData()
  return <DashboardDemo {...data} />
}

/**
 * The demo's read-only ports. The list port answers from the loader's own
 * data (the production list server fn is session-gated and an anonymous demo
 * has no session); the mark-as-read port refuses with the reason instead of
 * pretending to succeed — useServerAction folds the rejection into the error
 * channel the panel renders.
 */
function demoListNotifications(
  notifications: ReadonlyArray<NotificationPreview>
): ListNotifications {
  // oxlint-disable-next-line effect/noNewPromise -- the port contract is promise-shaped (a server-fn call in production); there is no Effect channel here
  return () => Promise.resolve(notifications)
}

function demoMarkNotificationsRead(): Promise<number> {
  // oxlint-disable-next-line effect/noNewPromise -- the rejection is the feature: this message is the honest answer to a click the demo cannot honor, folded into the panel's error channel
  return Promise.reject(
    // oxlint-disable-next-line effect/noNewError -- same rejection: the port contract has no Effect channel to raise a tagged error through
    new Error(
      'The live demo is read-only. Clone the starter and sign in as demo@starter.local to interact.'
    )
  )
}

/**
 * The same page component the signed-in dashboard renders — shell, header,
 * feed, notifications — with the read-only ports above.
 */
function DashboardDemo(data: WorkspaceDashboardPayload) {
  return (
    <WorkspaceDashboardPage
      data={data}
      ports={{
        listNotifications: demoListNotifications(data.notifications),
        markNotificationsRead: demoMarkNotificationsRead
      }}
    />
  )
}
