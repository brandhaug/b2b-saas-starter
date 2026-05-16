import { createFileRoute } from '@tanstack/react-router'
import { Effect } from 'effect'
import { ApiTokenForm } from '@/components/api-token-form'
import { WorkspaceShell } from '@/components/workspace-shell'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { runWorkspaceCapabilities } from '@/lib/capabilities'
import { requireSession } from '@/lib/server/auth'
import {
  ApiTokenRegistry,
  NotificationFeed,
  StarterModuleCatalog,
  WebhookEndpoints
} from '@b2b-saas-starter/capabilities'

export const Route = createFileRoute('/workspaces/$workspaceSlug/settings')({
  beforeLoad: ({ location }) => requireSession(location.href),
  loader: ({ params }) =>
    runWorkspaceCapabilities(
      params.workspaceSlug,
      Effect.gen(function* () {
        const catalog = yield* StarterModuleCatalog
        const tokens = yield* ApiTokenRegistry
        const webhooks = yield* WebhookEndpoints
        const feed = yield* NotificationFeed

        const [modules, apiTokens, endpoints, unread] = yield* Effect.all(
          [catalog.listModules, tokens.list, webhooks.list, feed.unreadCount],
          { concurrency: 'unbounded' }
        )
        return {
          modules,
          apiTokenCount: apiTokens.length,
          webhookCount: endpoints.length,
          unread
        }
      })
    ),
  component: WorkspaceSettingsPage
})

function WorkspaceSettingsPage() {
  const { workspaceSlug } = Route.useParams()
  const { modules, apiTokenCount, webhookCount, unread } = Route.useLoaderData()

  return (
    <WorkspaceShell
      title="Workspace settings"
      description="Module toggles, provider readiness, report schedule, API tokens, and webhook configuration."
      unreadCount={unread}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Module state</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {modules.map((module) => (
              <div
                key={module.id}
                className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{module.name}</p>
                  <p className="text-xs text-muted-foreground">{module.summary}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{module.state.status}</Badge>
                  <Switch checked={module.state.enabled} disabled />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operational settings</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <Label>Report schedule</Label>
              <p className="text-sm text-muted-foreground">
                Weekly implementation report delivery through Cloudflare Email activates
                when email configuration exists.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>API tokens</Label>
              <p className="text-sm text-muted-foreground">
                {apiTokenCount} workspace-scoped tokens are seeded. New tokens should be
                hashed and audited.
              </p>
              <ApiTokenForm workspaceSlug={workspaceSlug} />
            </div>
            <div className="grid gap-2">
              <Label>Outbound webhooks</Label>
              <p className="text-sm text-muted-foreground">
                {webhookCount} endpoint is configured for selected workspace events.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </WorkspaceShell>
  )
}
