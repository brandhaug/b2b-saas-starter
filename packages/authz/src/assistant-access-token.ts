import { type PermissionRequest } from './principal.ts'
import { Schema } from 'effect'
import {
  MCP_CONSENT_CLAIM,
  MCP_SESSION_ID_CLAIM,
  MCP_WORKSPACE_ID_CLAIM
} from './mcp-access-token.ts'

export const ASSISTANT_READ_SCOPE = 'assistant:read'
export const ASSISTANT_WRITE_SCOPE = 'assistant:write'
export const ASSISTANT_RESOURCE_SCOPES = [
  ASSISTANT_READ_SCOPE,
  ASSISTANT_WRITE_SCOPE,
  'offline_access'
]

/** Server-established references may be persisted; bearer secrets never may. */
export const AssistantCredentialReference = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('session'),
    userId: Schema.String,
    sessionId: Schema.String,
    expiresAt: Schema.Number
  }),
  Schema.Struct({
    kind: Schema.Literal('oauth'),
    userId: Schema.String,
    sessionId: Schema.String,
    expiresAt: Schema.Number,
    workspaceId: Schema.String,
    clientId: Schema.String,
    consentBinding: Schema.String,
    resource: Schema.String,
    scopes: Schema.Array(Schema.String)
  })
])
export type AssistantCredentialReference = typeof AssistantCredentialReference.Type
export type AssistantOAuthPrincipal = Extract<
  AssistantCredentialReference,
  { readonly kind: 'oauth' }
>

const Claims = Schema.Struct({
  sub: Schema.String,
  exp: Schema.Number,
  aud: Schema.String,
  scope: Schema.String,
  client_id: Schema.String,
  [MCP_WORKSPACE_ID_CLAIM]: Schema.String,
  [MCP_SESSION_ID_CLAIM]: Schema.String,
  [MCP_CONSENT_CLAIM]: Schema.String,
  cnf: Schema.optionalKey(Schema.Unknown)
})
const decodeClaims = Schema.decodeUnknownResult(Claims)

/** Signature, issuer, exact audience and expiry must already be verified. */
export function assistantAccessTokenPrincipal(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- verified JWT claims remain an untrusted dictionary until decoded here
  payload: Record<string, unknown>
): AssistantOAuthPrincipal | null {
  const result = decodeClaims(payload)
  if (result._tag === 'Failure' || result.success.cnf !== undefined) {
    return null
  }
  const claims = result.success
  if (
    !claims.sub ||
    !claims.client_id ||
    !claims[MCP_SESSION_ID_CLAIM] ||
    !claims[MCP_CONSENT_CLAIM] ||
    !claims[MCP_WORKSPACE_ID_CLAIM]
  ) {
    return null
  }
  return {
    kind: 'oauth',
    userId: claims.sub,
    sessionId: claims[MCP_SESSION_ID_CLAIM],
    workspaceId: claims[MCP_WORKSPACE_ID_CLAIM],
    expiresAt: claims.exp * 1000,
    clientId: claims.client_id,
    consentBinding: claims[MCP_CONSENT_CLAIM],
    resource: claims.aud,
    scopes: claims.scope.split(' ').filter(Boolean)
  }
}

/** Unknown persisted requirements fail closed. */
export function assistantPermissionRequest(
  permission: string
): PermissionRequest | null {
  switch (permission) {
    case 'assistant:read': {
      return { assistant: ['read'] }
    }
    case 'webhook:list': {
      return { webhook: ['list'] }
    }
    case 'auditLog:read': {
      return { auditLog: ['read'] }
    }
    default: {
      return null
    }
  }
}
