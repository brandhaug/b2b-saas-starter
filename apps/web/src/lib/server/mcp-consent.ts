import { type McpClientSummary } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { type WorkspaceListItemProjection } from '@b2b-saas-starter/capabilities/workspace-projections'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

export type OAuthConsentPayload = {
  /** `null` when the `client_id` names no registered client. */
  readonly client: McpClientSummary | null
  readonly workspaces: ReadonlyArray<WorkspaceListItemProjection>
  /**
   * The page's signed OAuth query, read off the incoming request server-side
   * (`null` when the page was opened without one) — the field the grant and
   * deny calls hand back to the provider verbatim.
   */
  readonly oauthQuery: string | null
}

const LoadOAuthConsentInput = Schema.Struct({
  // An id that names no registered client is a payload answer (`client:
  // null`), not an input error — so an empty or unknown id decodes fine.
  clientId: Schema.String
})

const GrantOAuthConsentInput = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  /** The page's signed OAuth query (`signedOAuthQuery` in `lib/oauth-query.ts`). */
  oauthQuery: Schema.NonEmptyString
})

const DenyOAuthConsentInput = Schema.Struct({
  oauthQuery: Schema.NonEmptyString
})

export type LoadOAuthConsentInput = typeof LoadOAuthConsentInput.Type
export type GrantOAuthConsentInput = typeof GrantOAuthConsentInput.Type
export type DenyOAuthConsentInput = typeof DenyOAuthConsentInput.Type

export const loadOAuthConsentServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(LoadOAuthConsentInput))
  .handler(async ({ data }): Promise<OAuthConsentPayload> => {
    const { loadOAuthConsentHandler } = await import('./mcp-consent.effects')
    return loadOAuthConsentHandler(data)
  })

/** Where the browser goes next: the client's redirect URI carrying the code, or its error. */
export type OAuthRedirect = { readonly url: string }

export const grantOAuthConsentServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(GrantOAuthConsentInput))
  .handler(async ({ data }): Promise<OAuthRedirect> => {
    const { grantOAuthConsentHandler } = await import('./mcp-consent.effects')
    return grantOAuthConsentHandler(data)
  })

export const denyOAuthConsentServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(DenyOAuthConsentInput))
  .handler(async ({ data }): Promise<OAuthRedirect> => {
    const { denyOAuthConsentHandler } = await import('./mcp-consent.effects')
    return denyOAuthConsentHandler(data)
  })
