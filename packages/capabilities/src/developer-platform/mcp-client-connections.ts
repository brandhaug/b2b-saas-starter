import { Context, Schema, type Effect } from 'effect'

import { type CapabilityUnavailable } from '../errors.ts'
import { type RecordAuditEventInput } from '../governance/audit-event-log.ts'

/**
 * MCP Client connections (ADR 0055): the standing OAuth consents a user has
 * granted to interactive MCP clients (Claude, Cursor, …), each bound to exactly
 * one Workspace. The consent rows themselves are written by Better Auth's OAuth
 * provider during the authorization flow; this capability owns everything the
 * starter does around them — the account page's list, revocation (which must
 * also revoke the tokens the consent minted, something the plugin's own
 * delete-consent endpoint does not do), and the two Audit Events.
 *
 * Seed adapter: [`mcp-client-connections.seed.ts`](./mcp-client-connections.seed.ts);
 * Live adapter: [`mcp-client-connections.live.ts`](./mcp-client-connections.live.ts).
 */

/** What the consent page and the account list show about a client. */
export const McpClientSummary = Schema.Struct({
  /** The OAuth `client_id` — for CIMD clients, the HTTPS URL of their metadata document. */
  clientId: Schema.String,
  name: Schema.NullOr(Schema.String),
  uri: Schema.NullOr(Schema.String)
})
export type McpClientSummary = typeof McpClientSummary.Type

export const McpClientConnectionWorkspace = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String
})

export const McpClientConnection = Schema.Struct({
  /** The consent id — what revoke takes. */
  id: Schema.String,
  client: McpClientSummary,
  /** `null` when the consented workspace has since been deleted. */
  workspace: Schema.NullOr(McpClientConnectionWorkspace),
  scopes: Schema.Array(Schema.String),
  grantedAt: Schema.String
})
export type McpClientConnection = typeof McpClientConnection.Type

export type RecordMcpConsentGrantInput = {
  readonly userId: string
  readonly workspaceId: string
  readonly clientId: string
  readonly scopes: ReadonlyArray<string>
}

export type RevokeMcpClientInput = {
  readonly userId: string
  readonly connectionId: string
}

/**
 * The two audit payloads, defined once so Seed and Live cannot drift — the
 * drift that would matter most is the revoked event's `workspaceId`: a consent
 * can outlive its workspace (the column is deliberately FK-free), and the
 * audit row it leaves behind must carry `workspaceId: null` then, because
 * `audit_events.workspace_id` cascades and a dangling id would fail the whole
 * write.
 */
export function consentGrantedAuditEvent(
  input: RecordMcpConsentGrantInput
): RecordAuditEventInput {
  return {
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    eventType: 'mcp_client.consent_granted',
    targetType: 'mcp_client',
    targetId: input.clientId,
    metadata: { scopes: [...input.scopes] }
  }
}

export function consentRevokedAuditEvent(input: {
  readonly userId: string
  readonly clientId: string
  readonly scopes: ReadonlyArray<string>
  /** The consented workspace's id, or `null` once that workspace is gone. */
  readonly workspaceId: string | null
}): RecordAuditEventInput {
  return {
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    eventType: 'mcp_client.consent_revoked',
    targetType: 'mcp_client',
    targetId: input.clientId,
    metadata: { scopes: [...input.scopes] }
  }
}

export type McpClientConnectionsInterface = {
  /** The client behind a `client_id`, or `null` when no such client is registered. */
  readonly describeClient: (
    clientId: string
  ) => Effect.Effect<McpClientSummary | null, CapabilityUnavailable>
  /** Every consent the user holds, newest first — an account-level read, not a workspace one. */
  readonly listForUser: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<McpClientConnection>, CapabilityUnavailable>
  /**
   * The `mcp_client.consent_granted` Audit Event. The consent row is the
   * plugin's write (an HTTP-shaped call, so the event cannot join it in a
   * batch — the ADR 0051 trade, again); the caller records it right after.
   */
  readonly recordGrant: (
    input: RecordMcpConsentGrantInput
  ) => Effect.Effect<void, CapabilityUnavailable>
  /**
   * Deletes the consent, revokes every refresh and access token it minted, and
   * records `mcp_client.consent_revoked` — one D1 batch. `false` when the id
   * names no consent of this user's, and nothing is written.
   */
  readonly revoke: (
    input: RevokeMcpClientInput
  ) => Effect.Effect<boolean, CapabilityUnavailable>
}

export class McpClientConnections extends Context.Service<
  McpClientConnections,
  McpClientConnectionsInterface
>()('@b2b-saas-starter/capabilities/McpClientConnections') {}
