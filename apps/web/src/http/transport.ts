import { FileSystem, Layer, Path } from 'effect'
import { Etag, HttpPlatform, HttpRouter } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import * as AccountPreferences from './handlers/account-preferences'
import * as RootData from './handlers/root-data'
import * as DemoShowcase from './handlers/demo-showcase'
import * as AssistantConversations from './handlers/assistant-conversations'
import * as AccountConversations from './handlers/account-conversations'
import * as NotificationPreferences from './handlers/notification-preferences'
import * as Account from './handlers/account'
import * as Admin from './handlers/admin'
import * as McpClients from './handlers/mcp-clients'
import * as EmailDelivery from './handlers/email-delivery'
import * as StrongAuthentication from './handlers/strong-authentication'
import * as Notifications from './handlers/notifications'
import * as WorkspaceOnboarding from './handlers/workspace-onboarding'
import * as WorkspaceDashboard from './handlers/workspace-dashboard'
import * as Invitations from './handlers/invitations'
import * as WorkspaceMembers from './handlers/workspace-members'
import * as ApiTokens from './handlers/api-tokens'
import * as Webhooks from './handlers/webhooks'
import * as WorkspaceAudit from './handlers/workspace-audit'
import * as Billing from './handlers/billing'
import * as Purchase from './handlers/purchase'
import * as WorkspaceSso from './handlers/workspace-sso'
import * as WorkspaceLifecycle from './handlers/workspace-lifecycle'
import * as WorkspaceExports from './handlers/workspace-exports'
import * as WorkspaceSettings from './handlers/workspace-settings'
import * as Assistant from './handlers/assistant'
import * as Turnstile from './handlers/turnstile'
import * as SocialProviders from './handlers/social-providers'
import * as EmailVerification from './handlers/email-verification'
import * as WorkspaceDirectory from './handlers/workspace-directory'
import * as McpConsent from './handlers/mcp-consent'
import * as WorkspaceSuspension from './handlers/workspace-suspension'
import * as AssistantTasks from './handlers/assistant-tasks'

const platform = Layer.mergeAll(
  Path.layer,
  Etag.layer,
  FileSystem.layerNoop({}),
  HttpPlatform.layer.pipe(Layer.provide(FileSystem.layerNoop({})))
)

export function createTransport() {
  return HttpRouter.toWebHandler(
    Layer.mergeAll(
      HttpApiBuilder.layer(AccountPreferences.Api).pipe(
        Layer.provide(AccountPreferences.handlers)
      ),
      HttpApiBuilder.layer(RootData.Api).pipe(Layer.provide(RootData.handlers)),
      HttpApiBuilder.layer(DemoShowcase.Api).pipe(Layer.provide(DemoShowcase.handlers)),
      HttpApiBuilder.layer(AssistantConversations.Api).pipe(
        Layer.provide(AssistantConversations.handlers)
      ),
      HttpApiBuilder.layer(AccountConversations.Api).pipe(
        Layer.provide(AccountConversations.handlers)
      ),
      HttpApiBuilder.layer(NotificationPreferences.Api).pipe(
        Layer.provide(NotificationPreferences.handlers)
      ),
      HttpApiBuilder.layer(Account.Api).pipe(Layer.provide(Account.handlers)),
      HttpApiBuilder.layer(Admin.Api).pipe(Layer.provide(Admin.handlers)),
      HttpApiBuilder.layer(McpClients.Api).pipe(Layer.provide(McpClients.handlers)),
      HttpApiBuilder.layer(EmailDelivery.Api).pipe(
        Layer.provide(EmailDelivery.handlers)
      ),
      HttpApiBuilder.layer(StrongAuthentication.Api).pipe(
        Layer.provide(StrongAuthentication.handlers)
      ),
      HttpApiBuilder.layer(Notifications.Api).pipe(
        Layer.provide(Notifications.handlers)
      ),
      HttpApiBuilder.layer(WorkspaceOnboarding.Api).pipe(
        Layer.provide(WorkspaceOnboarding.handlers)
      ),
      HttpApiBuilder.layer(WorkspaceDashboard.Api).pipe(
        Layer.provide(WorkspaceDashboard.handlers)
      ),
      HttpApiBuilder.layer(Invitations.Api).pipe(Layer.provide(Invitations.handlers)),
      HttpApiBuilder.layer(WorkspaceMembers.Api).pipe(
        Layer.provide(WorkspaceMembers.handlers)
      ),
      HttpApiBuilder.layer(ApiTokens.Api).pipe(Layer.provide(ApiTokens.handlers)),
      HttpApiBuilder.layer(Webhooks.Api).pipe(Layer.provide(Webhooks.handlers)),
      HttpApiBuilder.layer(WorkspaceAudit.Api).pipe(
        Layer.provide(WorkspaceAudit.handlers)
      ),
      HttpApiBuilder.layer(Billing.Api).pipe(Layer.provide(Billing.handlers)),
      HttpApiBuilder.layer(Purchase.Api).pipe(Layer.provide(Purchase.handlers)),
      HttpApiBuilder.layer(WorkspaceSso.Api).pipe(Layer.provide(WorkspaceSso.handlers)),
      HttpApiBuilder.layer(WorkspaceLifecycle.Api).pipe(
        Layer.provide(WorkspaceLifecycle.handlers)
      ),
      HttpApiBuilder.layer(WorkspaceExports.Api).pipe(
        Layer.provide(WorkspaceExports.handlers)
      ),
      HttpApiBuilder.layer(WorkspaceSettings.Api).pipe(
        Layer.provide(WorkspaceSettings.handlers)
      ),
      HttpApiBuilder.layer(Assistant.Api).pipe(Layer.provide(Assistant.handlers)),
      HttpApiBuilder.layer(Turnstile.Api).pipe(Layer.provide(Turnstile.handlers)),
      HttpApiBuilder.layer(SocialProviders.Api).pipe(
        Layer.provide(SocialProviders.handlers)
      ),
      HttpApiBuilder.layer(EmailVerification.Api).pipe(
        Layer.provide(EmailVerification.handlers)
      ),
      HttpApiBuilder.layer(WorkspaceDirectory.Api).pipe(
        Layer.provide(WorkspaceDirectory.handlers)
      ),
      HttpApiBuilder.layer(McpConsent.Api).pipe(Layer.provide(McpConsent.handlers)),
      HttpApiBuilder.layer(WorkspaceSuspension.Api).pipe(
        Layer.provide(WorkspaceSuspension.handlers)
      ),
      HttpApiBuilder.layer(AssistantTasks.Api).pipe(
        Layer.provide(AssistantTasks.handlers)
      )
    ).pipe(Layer.provide(platform)),
    { disableLogger: true }
  )
}
