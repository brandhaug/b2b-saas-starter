import {
  user,
  session,
  account,
  verification,
  twoFactor,
  passkey
} from './schema/auth.ts'
import {
  workspaces,
  workspaceDeletionFences,
  workspaceMembers,
  workspaceInvitations,
  workspaceSsoConnections
} from './schema/workspaces.ts'
import {
  apiTokens,
  webhookEndpoints,
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookInvestigationTasks
} from './schema/developer-platform.ts'
import { notifications, notificationPreferences } from './schema/notifications.ts'
import {
  auditEvents,
  workspaceExports,
  personalDataExports,
  retentionProgress
} from './schema/governance.ts'
import {
  jwks,
  oauthClient,
  oauthResource,
  oauthClientResource,
  oauthRefreshToken,
  oauthAccessToken,
  oauthConsent,
  oauthClientAssertion
} from './schema/oauth.ts'
import {
  workspaceSubscriptions,
  workspaceResourceSelections,
  billingProviderEvents,
  billingSynchronization,
  billingCheckoutClaims,
  billingNotices
} from './schema/billing.ts'
import { emailDeliveries } from './schema/email-delivery.ts'
import {
  assistantConversations,
  assistantReservations,
  assistantSessionAuthority
} from './schema/assistant.ts'

/** Complete table registry for adapter configuration and migrated-schema inspection. */
export const schema = {
  user,
  session,
  account,
  verification,
  twoFactor,
  passkey,
  workspaces,
  workspaceDeletionFences,
  workspaceMembers,
  workspaceInvitations,
  workspaceSsoConnections,
  apiTokens,
  webhookEndpoints,
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookInvestigationTasks,
  notifications,
  notificationPreferences,
  auditEvents,
  workspaceExports,
  personalDataExports,
  jwks,
  oauthClient,
  oauthResource,
  oauthClientResource,
  oauthRefreshToken,
  oauthAccessToken,
  workspaceSubscriptions,
  workspaceResourceSelections,
  billingProviderEvents,
  billingSynchronization,
  billingCheckoutClaims,
  oauthConsent,
  oauthClientAssertion,
  billingNotices,
  emailDeliveries,
  retentionProgress,
  assistantConversations,
  assistantReservations,
  assistantSessionAuthority
}
