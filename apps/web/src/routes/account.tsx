import { createFileRoute } from '@tanstack/react-router'
import { AccountPage } from '@/components/account-page'
import { pageTitle } from '@/components/page/page-title'
import { authClient } from '@/lib/auth-client'
import { requireSession } from '@/lib/server/auth'
import { loadAccountPageServerFn } from '@/lib/server/account'
import { loadMcpClientConnectionsServerFn } from '@/lib/server/mcp-clients'

// Account settings live outside the /workspaces subtree on purpose: they are
// user-level, not workspace-level, so the route keeps its own session gate
// (same reasoning as /invitations/accept). There is no workspace to resolve —
// and nothing to be a member of.
export const Route = createFileRoute('/account')({
  beforeLoad: async ({ location }) => {
    const session = await requireSession(location.href)
    return { session }
  },
  // The deletion plan and notification preferences compose into one server
  // call (see `account.effects.ts`); the MCP clients connected to this
  // account (ADR 0068) ride beside it via their own server fn — all
  // identity-keyed, no workspace involved.
  loader: async () => {
    // oxlint-disable-next-line effect/noNewPromise -- TanStack loaders are promise-shaped; Promise.all keeps the account read and the MCP-client read parallel
    const [account, connections] = await Promise.all([
      loadAccountPageServerFn(),
      loadMcpClientConnectionsServerFn()
    ])
    return { ...account, connections }
  },
  component: AccountRoute,
  head: () => ({ meta: [{ title: pageTitle('Account') }] })
})

/**
 * The route's thin wrapper: reads the context and loader data the router
 * resolved, and hands them to the page. The page itself lives in
 * `components/account-page.tsx` — a page exported from the route file would
 * pin its import graph into the route tree every page preloads.
 */
function AccountRoute() {
  const { session } = Route.useRouteContext()
  const { deletionPlan, preferences, connections } = Route.useLoaderData()
  // The current session token never rides the SSR payload (see `RouteSession`
  // in lib/server/auth.ts) — the panel reads it from the client session hook.
  const currentSession = authClient.useSession()
  return (
    <AccountPage
      session={session}
      deletionPlan={deletionPlan}
      preferences={preferences}
      connections={connections}
      currentSessionToken={currentSession.data?.session.token ?? ''}
    />
  )
}
