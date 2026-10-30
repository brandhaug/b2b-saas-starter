import { redirectSearch } from '@/lib/utils'
import { loadOwnedConversationsServerFn } from '@/lib/server/account-conversations'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { pageQueryOptions } from '@/lib/page-query'
import { AccountPage } from '@/components/account-page'
import { pageTitle } from '@/components/page/page-title'
import { authClient } from '@/lib/auth-client'
import { requireSession } from '@/lib/server/auth'
import { loadAccountPageServerFn } from '@/lib/server/account'
import { loadMcpClientConnectionsServerFn } from '@/lib/server/mcp-clients'
import { m } from '@b2b-saas-starter/i18n/messages'

// Account settings live outside the /workspaces subtree on purpose: they are
// user-level, not workspace-level, so the route keeps its own session gate
// (same reasoning as /invitations/accept). There is no workspace to resolve —
// and nothing to be a member of.
function accountQuery(actorId: string) {
  return pageQueryOptions(['account-page', actorId], async () => {
    // oxlint-disable-next-line effect/noNewPromise -- independent client-safe server reads
    const [account, connections] = await Promise.all([
      loadAccountPageServerFn(),
      loadMcpClientConnectionsServerFn()
    ])
    return { ...account, connections }
  })
}

function conversationsQuery(actorId: string) {
  return pageQueryOptions(
    ['account-conversations', actorId],
    loadOwnedConversationsServerFn
  )
}

export const Route = createFileRoute('/account')({
  validateSearch: redirectSearch,
  beforeLoad: async ({ location }) => {
    const session = await requireSession(location.href)
    return { session }
  },
  // The deletion plan and notification preferences compose into one server
  // call (see `account.effects.ts`); the MCP clients connected to this
  // account (ADR 0068) ride beside it via their own server fn — all
  // identity-keyed, no workspace involved.
  loader: async ({ context }) => {
    // oxlint-disable-next-line effect/noNewPromise -- TanStack loaders are promise-shaped; Promise.all keeps the account read and the MCP-client read parallel
    const [account, ownedConversations] = await Promise.all([
      context.queryClient.query({
        ...accountQuery(context.session.user.id),
        staleTime: 0
      }),
      context.queryClient.query({
        ...conversationsQuery(context.session.user.id),
        staleTime: 0
      })
    ])
    return { ...account, ownedConversations }
  },
  component: AccountRoute,
  head: () => ({ meta: [{ title: pageTitle(m.public_meta_account()) }] })
})

/**
 * The route's thin wrapper: reads the context and loader data the router
 * resolved, and hands them to the page. The page itself lives in
 * `components/account-page.tsx` — a page exported from the route file would
 * pin its import graph into the route tree every page preloads.
 */
function AccountRoute() {
  const { session } = Route.useRouteContext()
  const { redirect } = Route.useSearch()
  const {
    data: { deletionPlan, preferences, connections }
  } = useSuspenseQuery(accountQuery(session.user.id))
  const { data: ownedConversations } = useSuspenseQuery(
    conversationsQuery(session.user.id)
  )
  // The current session token never rides the SSR payload (see `RouteSession`
  // in lib/server/auth.ts) — the panel reads it from the client session hook.
  const currentSession = authClient.useSession()
  return (
    <AccountPage
      session={session}
      redirect={redirect}
      deletionPlan={deletionPlan}
      preferences={preferences}
      connections={connections}
      ownedConversations={ownedConversations}
      currentSessionToken={currentSession.data?.session.token ?? ''}
    />
  )
}
