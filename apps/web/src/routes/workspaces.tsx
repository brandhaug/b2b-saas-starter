import { Outlet, createFileRoute } from '@tanstack/react-router'
import { listWorkspacesForUser } from '@b2b-saas-starter/capabilities/workspace-projections'
import { RoutePending } from '@/components/route-pending'
import { requireSession } from '@/lib/server/auth'
import { runCapabilities } from '@/lib/capabilities'
import {
  WorkspaceDirectoryContext,
  type WorkspaceDirectory
} from '@/lib/workspace-directory'

// Layout route for the /workspaces subtree: the auth gate runs ONCE here and
// children (index, $workspaceSlug, settings) read `context.session` instead
// of re-gating. `location.href` is the full target location, so the
// `?redirect=` round-trip through /sign-in is preserved (asserted by
// e2e/smoke.spec.ts). /admin keeps its own gate — it needs `requireAdmin`.
export const Route = createFileRoute('/workspaces')({
  beforeLoad: async ({ location }) => {
    const session = await requireSession(location.href)
    return { session }
  },
  // The workspace directory (the `listWorkspacesForUser` projection) loads
  // once per subtree visit and feeds the sidebar switcher, the user menu's
  // switch submenu, and the workspaces index — one read, published through
  // the context provider below instead of a payload prop on every page.
  loader: ({ context }) =>
    runCapabilities(listWorkspacesForUser(context.session.user.id)),
  pendingComponent: RoutePending,
  component: WorkspacesLayout
})

function WorkspacesLayout() {
  const directory: WorkspaceDirectory = Route.useLoaderData()
  return (
    <WorkspaceDirectoryContext.Provider value={directory}>
      <Outlet />
    </WorkspaceDirectoryContext.Provider>
  )
}
