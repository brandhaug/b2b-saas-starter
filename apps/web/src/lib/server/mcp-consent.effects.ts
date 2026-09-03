import { MCP_CONSENT_PAGE, MCP_WORKSPACE_SELECTED_HEADER } from '@b2b-saas-starter/auth'
import { McpClientConnections } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { listWorkspacesForUser } from '@b2b-saas-starter/capabilities/workspace-projections'
import { Effect, Schema } from 'effect'

import { runCapabilities } from '../capabilities'
import { type OAuthConsentPayload, type OAuthRedirect } from './mcp-consent'
import { sessionCall } from './plugin-call'

/**
 * The consent page's behaviour (ADR 0054), below the session gate.
 *
 * Granting is three calls to the app's own OAuth provider, in an order the
 * plugin fixes: (1) `setActiveOrganization` writes the pick onto the session —
 * the plugin refuses a workspace the user is not a member of; (2)
 * `oauth2/continue` resumes the authorization with the header that vouches for
 * the pick (`postLogin.shouldRedirect` in `packages/auth` reads it), which
 * makes the picked workspace the consent's reference id; the provider then
 * either issues the code (a standing consent for this client and workspace
 * already exists) or sends the browser back to the consent page; (3) in the
 * latter case `oauth2/consent` records the consent and issues the code. Each
 * answers with the URL the browser should go to next; the page navigates to
 * the last one.
 */

/** Every OAuth redirect endpoint answers this when the caller accepts JSON. */
const RedirectResult = Schema.Struct({ url: Schema.String })
const decodeRedirect = Schema.decodeUnknownSync(RedirectResult)

/** Absolute-or-relative, the provider's redirect target as a URL we can inspect. */
function redirectUrl(result: typeof RedirectResult.Type): URL {
  return new URL(result.url, 'http://relative.invalid')
}

function withWorkspaceSelected(headers: Headers, workspaceId: string): Headers {
  const selected = new Headers(headers)
  selected.set(MCP_WORKSPACE_SELECTED_HEADER, workspaceId)
  return selected
}

/**
 * The provider's authorize re-entry (`oauth2/continue`, `oauth2/consent`) runs
 * `authorizeEndpoint` again, which demands a request context and reads the
 * session off its headers. A minimal carrier for the caller's headers is
 * exactly what the plugin's own resume path passes; it is deliberately NOT a
 * `Request` instance, so the endpoint answers with parsed JSON rather than a
 * `Response`.
 */
function oauthRequest(headers: Headers): Request {
  // SAFETY: only `headers` and `method` are read downstream; the shape check
  // `isRequestLike` runs on the dispatch boundary must keep failing, which a
  // plain object guarantees.
  // oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion -- a header carrier stands in for the Request the router would have supplied
  return { headers, method: 'POST' } as Request
}

/** The scopes the redirect back to the consent page names — what the consent, and its Audit Event, cover. */
function scopesOf(url: URL): ReadonlyArray<string> {
  return (url.searchParams.get('scope') ?? '')
    .split(' ')
    .filter((scope) => scope.length > 0)
}

export function loadOAuthConsent(input: {
  readonly userId: string
  readonly clientId: string
}): Promise<OAuthConsentPayload> {
  return runCapabilities(
    Effect.all(
      {
        client: Effect.flatMap(McpClientConnections, (connections) =>
          connections.describeClient(input.clientId)
        ),
        workspaces: listWorkspacesForUser(input.userId)
      },
      { concurrency: 'unbounded' }
    )
  )
}

export async function grantOAuthConsent(input: {
  readonly userId: string
  readonly workspaceId: string
  readonly oauthQuery: string
}): Promise<OAuthRedirect> {
  await sessionCall((api, headers) =>
    api.setActiveOrganization({ body: { organizationId: input.workspaceId }, headers })
  )
  const continued = redirectUrl(
    decodeRedirect(
      await sessionCall((api, headers) =>
        api.oauth2Continue({
          body: { postLogin: true, oauth_query: input.oauthQuery },
          headers: withWorkspaceSelected(headers, input.workspaceId),
          request: oauthRequest(headers)
        })
      )
    )
  )
  if (continued.pathname !== MCP_CONSENT_PAGE) {
    // A standing consent covered the request: the code was issued without a
    // new grant, so there is nothing new to audit.
    return { url: continued.href.replace('http://relative.invalid', '') }
  }
  const consented = redirectUrl(
    decodeRedirect(
      await sessionCall((api, headers) =>
        api.oauth2Consent({
          body: { accept: true, oauth_query: continued.search.slice(1) },
          headers,
          request: oauthRequest(headers)
        })
      )
    )
  )
  const clientId = continued.searchParams.get('client_id') ?? 'unknown'
  await runCapabilities(
    Effect.flatMap(McpClientConnections, (connections) =>
      connections.recordGrant({
        userId: input.userId,
        workspaceId: input.workspaceId,
        clientId,
        scopes: scopesOf(continued)
      })
    )
  )
  return { url: consented.href.replace('http://relative.invalid', '') }
}

export async function denyOAuthConsent(input: {
  readonly oauthQuery: string
}): Promise<OAuthRedirect> {
  const denied = redirectUrl(
    decodeRedirect(
      await sessionCall((api, headers) =>
        api.oauth2Consent({
          body: { accept: false, oauth_query: input.oauthQuery },
          headers,
          request: oauthRequest(headers)
        })
      )
    )
  )
  return { url: denied.href.replace('http://relative.invalid', '') }
}
