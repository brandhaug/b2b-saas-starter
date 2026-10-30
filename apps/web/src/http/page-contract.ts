import { Schema } from 'effect'
import * as Account from './contracts/account'
import * as AccountConversations from './contracts/account-conversations'
import * as Admin from './contracts/admin'
import * as Assistant from './contracts/assistant'
import * as Audit from './contracts/workspace-audit'
import * as Billing from './contracts/billing'
import * as Consent from './contracts/mcp-consent'
import * as Dashboard from './contracts/workspace-dashboard'
import * as Demo from './contracts/demo-showcase'
import * as Directory from './contracts/workspace-directory'
import * as Email from './contracts/email-delivery'
import * as Invitations from './contracts/invitations'
import * as Members from './contracts/workspace-members'
import * as Mcp from './contracts/mcp-clients'
import * as Notifications from './contracts/notification-preferences'
import * as Purchase from './contracts/purchase'
import * as Root from './contracts/root-data'
import * as Settings from './contracts/workspace-settings'
import * as StrongAuth from './contracts/strong-authentication'
import * as Suspension from './contracts/workspace-suspension'
import * as Tokens from './contracts/api-tokens'
import * as Webhooks from './contracts/webhooks'
import { UiErrorPayload } from '../lib/ui-error'

export const RouteSession = Schema.Struct({
  user: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
    emailVerified: Schema.Boolean,
    role: Schema.String,
    twoFactorEnabled: Schema.Boolean
  }),
  impersonatedBy: Schema.NullOr(Schema.String)
})

/** Request-specific data only. Static content and document metadata belong to the renderer. */
export const Page = Schema.TaggedUnion({
  public: { demo: Schema.NullOr(Demo.loadDemoShowcaseServerFnResponse) },
  help: {
    email: Schema.NullOr(Schema.String),
    helpdeskUrl: Schema.NullOr(Schema.String),
    helpCenterUrl: Schema.NullOr(Schema.String),
    appVersion: Schema.NullOr(Schema.String)
  },
  auth: {
    turnstileSiteKey: Schema.NullOr(Schema.String),
    socialProviders: Schema.Array(Schema.Literals(['github', 'google'])),
    emailVerified: Schema.Boolean
  },
  directory: { turnstileSiteKey: Schema.NullOr(Schema.String) },
  dashboard: { data: Dashboard.loadWorkspaceDashboardServerFnResponse },
  members: { data: Members.loadWorkspaceMembersServerFnResponse },
  settings: { data: Settings.loadWorkspaceSettingsServerFnResponse },
  billing: { data: Billing.loadWorkspaceBillingServerFnResponse },
  'api-tokens': { data: Tokens.loadWorkspaceApiTokensServerFnResponse },
  webhooks: { data: Webhooks.loadWorkspaceWebhooksServerFnResponse },
  audit: { data: Audit.loadWorkspaceAuditEventsServerFnResponse },
  assistant: { data: Assistant.loadAssistantPageServerFnResponse },
  suspended: { data: Suspension.loadWorkspaceRecoveryServerFnResponse },
  pricing: { data: Billing.loadPublicPricingServerFnResponse },
  account: {
    data: Account.loadAccountPageServerFnResponse,
    connections: Mcp.loadMcpClientConnectionsServerFnResponse,
    ownedConversations: AccountConversations.loadOwnedConversationsServerFnResponse
  },
  'account-notifications': {
    data: Notifications.loadNotificationPreferencesServerFnResponse,
    deliveries: Email.loadOwnEmailDeliveryServerFnResponse,
    turnstileSiteKey: Schema.NullOr(Schema.String)
  },
  admin: {
    users: Admin.listSystemUsersServerFnResponse,
    events: Admin.loadAdminAuditEventsServerFnResponse,
    failedDeliveries: Admin.loadFailedDeliveriesServerFnResponse,
    emailDeliveries: Email.loadSystemEmailDeliveryServerFnResponse,
    workspaces: Admin.listAdminWorkspacesServerFnResponse
  },
  consent: { data: Consent.loadOAuthConsentServerFnResponse },
  invitation: { data: Invitations.invitationPreviewServerFnResponse },
  purchase: {
    data: Schema.NullOr(Purchase.loadPurchaseServerFnResponse),
    turnstileSiteKey: Schema.NullOr(Schema.String)
  },
  verification: { data: StrongAuth.strongAuthenticationStatusServerFnResponse }
})
export type Page = typeof Page.Type

export const PageData = Schema.Struct({
  root: Schema.NullOr(Root.rootDataServerFnResponse),
  session: Schema.NullOr(RouteSession),
  directory: Schema.NullOr(Directory.loadWorkspaceDirectoryServerFnResponse),
  suspension: Schema.NullOr(Suspension.loadWorkspaceSuspensionServerFnResponse),
  page: Schema.NullOr(Page),
  locale: Schema.Literals(['en', 'nb']),
  presentation: Schema.Struct({
    timeZone: Schema.String,
    authenticated: Schema.Boolean,
    needsTimeZone: Schema.Boolean
  }),
  status: Schema.Number,
  error: Schema.NullOr(UiErrorPayload)
})
export type PageData = typeof PageData.Type
