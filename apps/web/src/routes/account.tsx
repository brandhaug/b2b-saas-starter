import { createFileRoute } from '@tanstack/react-router'
import { TwoFactorPanel } from '@/components/two-factor-panel'
import { SessionsPanel } from '@/components/sessions-panel'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  component: AccountRoute
})

function AccountRoute() {
  const { session } = Route.useRouteContext()
  // The current session token never rides the SSR payload (see `RouteSession`
  // in lib/server/auth.ts) — the panel reads it from the client session hook.
  const currentSession = authClient.useSession()
  return (
    <WorkspaceShell
      viewer={null}
      title="Account"
      description="Sign-in security for your account, not any one workspace."
      workspaceSlug={null}
    >
      <div className="mx-auto grid max-w-2xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Two-factor authentication</CardTitle>
            <p className="text-sm text-muted-foreground">
              Require a time-based one-time code from an authenticator app at every
              sign-in.
            </p>
          </CardHeader>
          <CardContent>
            <TwoFactorPanel twoFactorEnabled={session.user.twoFactorEnabled} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
            <p className="text-sm text-muted-foreground">
              Every device currently signed in as you. Revoking a session signs it out
              immediately.
            </p>
          </CardHeader>
          <CardContent>
            <SessionsPanel
              currentSessionToken={currentSession.data?.session.token ?? ''}
            />
          </CardContent>
        </Card>
      </div>
    </WorkspaceShell>
  )
}
