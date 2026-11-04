import { sql } from 'drizzle-orm'
import { Schema } from 'effect'
import {
  customType,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'
import { user, session } from './auth.ts'
import { id, authCreatedAt, authTimestamps } from './columns.ts'
import { type JsonValue } from './json.ts'

/*
 * Better Auth `jwt` plugin and `@better-auth/mcp` (the OAuth 2.1 provider it is
 * built on) — ADR 0055. Plugin-owned shape: camelCase columns, epoch-integer
 * dates, surrogate `id` keys, `string[]`/`json` fields as JSON text. The
 * export keys are the plugin's model names, which is what the drizzle adapter
 * resolves models by; the SQL names are snake_case like every other table.
 */

/** Better Auth's SQLite adapter pre-serializes arrays; direct Drizzle callers pass arrays. */
const authArray = Schema.Array(Schema.String)
const authArrayJson = Schema.fromJsonString(authArray)
const decodeAuthArrayInput = Schema.decodeUnknownSync(
  Schema.Union([authArray, authArrayJson])
)
const encodeAuthArray = Schema.encodeSync(authArrayJson)
const decodeAuthArray = Schema.decodeUnknownSync(authArrayJson)
const authStringArray = customType<{ data: ReadonlyArray<string>; driverData: string }>(
  {
    dataType: () => 'text',
    toDriver: (value) => encodeAuthArray(decodeAuthArrayInput(value)),
    fromDriver: decodeAuthArray
  }
)

/** A Better Auth `json` field with no declared shape beyond "JSON". */
function authJson(column: string) {
  return text(column, { mode: 'json' }).$type<JsonValue>()
}

/** The jwt plugin's signing keys; the public halves are served at `/api/auth/jwks`. */
export const jwks = sqliteTable('jwks', {
  id: id(),
  publicKey: text('publicKey').notNull(),
  privateKey: text('privateKey').notNull(),
  createdAt: authCreatedAt(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }),
  alg: text('alg'),
  crv: text('crv')
})

/** An OAuth client — for MCP, discovered from a Client ID Metadata Document. */
export const oauthClient = sqliteTable(
  'oauth_client',
  {
    id: id(),
    clientId: text('clientId').unique().notNull(),
    clientSecret: text('clientSecret'),
    clientDiscoveryId: text('clientDiscoveryId'),
    disabled: integer('disabled', { mode: 'boolean' }).default(false),
    skipConsent: integer('skipConsent', { mode: 'boolean' }),
    enableEndSession: integer('enableEndSession', { mode: 'boolean' }),
    subjectType: text('subjectType'),
    scopes: authStringArray('scopes'),
    clientCredentialsScopes: authStringArray('clientCredentialsScopes').default(
      sql`'[]'`
    ),
    userId: text('userId').references(() => user.id),
    createdAt: integer('createdAt', { mode: 'timestamp' }),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: authStringArray('contacts'),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('softwareId'),
    softwareVersion: text('softwareVersion'),
    softwareStatement: text('softwareStatement'),
    redirectUris: authStringArray('redirectUris').notNull(),
    postLogoutRedirectUris: authStringArray('postLogoutRedirectUris'),
    backchannelLogoutUri: text('backchannelLogoutUri'),
    backchannelLogoutSessionRequired: integer('backchannelLogoutSessionRequired', {
      mode: 'boolean'
    }),
    tokenEndpointAuthMethod: text('tokenEndpointAuthMethod'),
    applicationType: text('applicationType'),
    jwks: text('jwks'),
    jwksUri: text('jwksUri'),
    grantTypes: authStringArray('grantTypes'),
    responseTypes: authStringArray('responseTypes'),
    requirePKCE: integer('requirePKCE', { mode: 'boolean' }),
    dpopBoundAccessTokens: integer('dpopBoundAccessTokens', {
      mode: 'boolean'
    }).default(false),
    referenceId: text('referenceId'),
    metadata: authJson('metadata')
  },
  (table) => [index('oauth_client_user_id_idx').on(table.userId)]
)

/** A protected resource (RFC 8707) — the MCP server's `/mcp` URL is seeded at boot. */
export const oauthResource = sqliteTable('oauth_resource', {
  id: id(),
  identifier: text('identifier').unique().notNull(),
  name: text('name').notNull(),
  accessTokenTtl: integer('accessTokenTtl'),
  refreshTokenTtl: integer('refreshTokenTtl'),
  signingAlgorithm: text('signingAlgorithm'),
  signingKeyId: text('signingKeyId'),
  allowedScopes: authStringArray('allowedScopes'),
  customClaims: authJson('customClaims'),
  dpopBoundAccessTokensRequired: integer('dpopBoundAccessTokensRequired', {
    mode: 'boolean'
  }).default(false),
  disabled: integer('disabled', { mode: 'boolean' }).default(false),
  createdAt: integer('createdAt', { mode: 'timestamp' }),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }),
  policyVersion: integer('policyVersion').default(1),
  metadata: authJson('metadata')
})

/** Which clients may request which resources (the plugin links MCP clients on registration). */
export const oauthClientResource = sqliteTable(
  'oauth_client_resource',
  {
    id: id(),
    clientId: text('clientId')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    resourceId: text('resourceId')
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: 'cascade' }),
    metadata: authJson('metadata'),
    createdAt: integer('createdAt', { mode: 'timestamp' })
  },
  (table) => [
    index('oauth_client_resource_resource_id_idx').on(table.resourceId),
    uniqueIndex('oauth_client_resource_client_resource_idx').on(
      table.clientId,
      table.resourceId
    )
  ]
)

export const oauthRefreshToken = sqliteTable(
  'oauth_refresh_token',
  {
    id: id(),
    token: text('token').unique().notNull(),
    clientId: text('clientId')
      .notNull()
      .references(() => oauthClient.clientId),
    // Retain the grant's originating identity after natural browser-session cleanup.
    sessionId: text('sessionId'),
    userId: text('userId')
      .notNull()
      .references(() => user.id),
    referenceId: text('referenceId'),
    authorizationCodeId: text('authorizationCodeId'),
    resources: authStringArray('resources'),
    requestedUserInfoClaims: authStringArray('requestedUserInfoClaims'),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    createdAt: authCreatedAt(),
    revoked: integer('revoked', { mode: 'timestamp' }),
    rotatedAt: integer('rotatedAt', { mode: 'timestamp' }),
    rotationReplayResponse: text('rotationReplayResponse'),
    rotationReplayExpiresAt: integer('rotationReplayExpiresAt', { mode: 'timestamp' }),
    authTime: integer('authTime', { mode: 'timestamp' }),
    confirmation: authJson('confirmation'),
    scopes: authStringArray('scopes').notNull()
  },
  (table) => [
    index('oauth_refresh_token_client_id_idx').on(table.clientId),
    index('oauth_refresh_token_session_id_idx').on(table.sessionId),
    index('oauth_refresh_token_user_id_idx').on(table.userId),
    index('oauth_refresh_token_authorization_code_id_idx').on(table.authorizationCodeId)
  ]
)

/** Opaque access tokens only; MCP access tokens are JWTs and never land here. */
export const oauthAccessToken = sqliteTable(
  'oauth_access_token',
  {
    id: id(),
    token: text('token').unique().notNull(),
    clientId: text('clientId')
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text('sessionId').references(() => session.id, { onDelete: 'set null' }),
    userId: text('userId').references(() => user.id),
    referenceId: text('referenceId'),
    authorizationCodeId: text('authorizationCodeId'),
    resources: authStringArray('resources'),
    requestedUserInfoClaims: authStringArray('requestedUserInfoClaims'),
    refreshId: text('refreshId').references(() => oauthRefreshToken.id),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    createdAt: authCreatedAt(),
    revoked: integer('revoked', { mode: 'timestamp' }),
    confirmation: authJson('confirmation'),
    scopes: authStringArray('scopes').notNull()
  },
  (table) => [
    index('oauth_access_token_client_id_idx').on(table.clientId),
    index('oauth_access_token_session_id_idx').on(table.sessionId),
    index('oauth_access_token_user_id_idx').on(table.userId),
    index('oauth_access_token_authorization_code_id_idx').on(table.authorizationCodeId),
    index('oauth_access_token_refresh_id_idx').on(table.refreshId),
    index('oauth_access_token_expiry_idx').on(table.expiresAt, table.id)
  ]
)

/**
 * One user's standing consent to one MCP Client. `referenceId` is the chosen
 * workspace id (the consent page's pick, carried by the plugin's reference
 * mechanism — see `packages/auth`), so a client consented for workspace A holds
 * no consent for workspace B.
 */
export const oauthConsent = sqliteTable(
  'oauth_consent',
  {
    id: id(),
    // DB trigger increments on consent changes, including same-second updates.
    grantVersion: integer('grant_version').notNull().default(0),
    clientId: text('clientId')
      .notNull()
      .references(() => oauthClient.clientId),
    userId: text('userId').references(() => user.id),
    referenceId: text('referenceId'),
    resources: authStringArray('resources'),
    requestedUserInfoClaims: authStringArray('requestedUserInfoClaims'),
    scopes: authStringArray('scopes').notNull(),
    ...authTimestamps()
  },
  (table) => [
    index('oauth_consent_client_id_idx').on(table.clientId),
    index('oauth_consent_user_id_idx').on(table.userId)
  ]
)

/** Replay guard for `private_key_jwt` client assertions (`jti` + expiry). */
export const oauthClientAssertion = sqliteTable(
  'oauth_client_assertion',
  {
    id: id(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull()
  },
  (table) => [index('oauth_client_assertion_expiry_idx').on(table.expiresAt, table.id)]
)
