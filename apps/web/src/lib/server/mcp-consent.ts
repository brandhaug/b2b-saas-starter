import { type McpClientSummary } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { type WorkspaceListItemProjection } from '@b2b-saas-starter/capabilities/workspace-projections'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

import { requireRequestSession } from './auth'
import { signedOAuthQuery } from '../oauth-query'
import { currentRequest } from '../request-context'

/**
 * Server functions for the OAuth consent page (ADR 0054): declarations only.
 * The behaviour — the Better Auth endpoint calls that turn a workspace pick
 * into a consent and an authorization code — lives in `mcp-consent.effects.ts`
 * and is reached through dynamic `import()`, so the route tree never carries
 * the auth server into the browser bundle (the same split
 * `invitations.ts` / `invitations.effects.ts` uses).
 */

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

const LoadInput = Schema.Struct({ clientId: Schema.String })
const decodeLoadInput = Schema.decodeUnknownSync(LoadInput)

export const loadOAuthConsentServerFn = createServerFn({ method: 'GET' })
  .validator((input) => decodeLoadInput(input))
  .handler(async ({ data }): Promise<OAuthConsentPayload> => {
    const session = await requireRequestSession()
    // The signed query is read here, on the server, from the request the
    // provider's redirect arrived on — never from `window` in a component.
    const request = currentRequest()
    const oauthQuery =
      request === undefined ? null : signedOAuthQuery(new URL(request.url).search)
    const { loadOAuthConsent } = await import('./mcp-consent.effects')
    const payload = await loadOAuthConsent({
      userId: session.user.id,
      clientId: data.clientId
    })
    return { ...payload, oauthQuery }
  })

/** Where the browser goes next: the client's redirect URI carrying the code, or its error. */
export type OAuthRedirect = { readonly url: string }

const GrantInput = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  /** The page's signed OAuth query (`signedOAuthQuery` in `lib/oauth-query.ts`). */
  oauthQuery: Schema.NonEmptyString
})
const decodeGrantInput = Schema.decodeUnknownSync(GrantInput)

export const grantOAuthConsentServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeGrantInput(input))
  .handler(async ({ data }): Promise<OAuthRedirect> => {
    const session = await requireRequestSession()
    const { grantOAuthConsent } = await import('./mcp-consent.effects')
    return grantOAuthConsent({
      userId: session.user.id,
      workspaceId: data.workspaceId,
      oauthQuery: data.oauthQuery
    })
  })

const DenyInput = Schema.Struct({ oauthQuery: Schema.NonEmptyString })
const decodeDenyInput = Schema.decodeUnknownSync(DenyInput)

export const denyOAuthConsentServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeDenyInput(input))
  .handler(async ({ data }): Promise<OAuthRedirect> => {
    await requireRequestSession()
    const { denyOAuthConsent } = await import('./mcp-consent.effects')
    return denyOAuthConsent({ oauthQuery: data.oauthQuery })
  })
