import { createFileRoute } from '@tanstack/react-router'
import { TwoFactorPanel } from '@/components/two-factor-panel'
import { SessionsPanel } from '@/components/sessions-panel'
import { PageHeader } from '@/components/page/page-header'
import { pageTitle } from '@/components/page/page-title'
import { Panel } from '@/components/page/panel'
import { WorkspaceShell } from '@/components/workspace-shell'
import { authClient } from '@/lib/auth-client'
import { requireSession } from '@/lib/server/auth'

// Account settings live outside the /workspaces subtree on purpose: they are
// user-level, not workspace-level, so the route keeps its own session gate
// (same reasoning as /invitations/accept). There is no workspace to resolve —
// and nothing to be a member of.
export const Route = createFileRoute('/account')({
  beforeLoad: async ({ location }) => {
    const session = await requireSession(location.href)
    return { session }
  },
  component: AccountRoute,
  head: () => ({ meta: [{ title: pageTitle('Account') }] })
})

function AccountRoute() {
  const { session } = Route.useRouteContext()
  // The current session token never rides the SSR payload (see `RouteSession`
  // in lib/server/auth.ts) — the panel reads it from the client session hook.
  const currentSession = authClient.useSession()
  return (
    <WorkspaceShell viewer={null} systemRole={session.user.role} workspaceSlug={null}>
      <PageHeader
        title="Account"
        description="Sign-in security for your account, not any one workspace."
      />
      <Panel
        title="Two-factor authentication"
        description="Require a time-based one-time code from an authenticator app at every sign-in."
      >
        <TwoFactorPanel twoFactorEnabled={session.user.twoFactorEnabled} />
      </Panel>

      <SessionsPanel currentSessionToken={currentSession.data?.session.token ?? ''} />
    </WorkspaceShell>
  )
}
