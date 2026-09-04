import { MCP_CONSENT_PAGE, MCP_WORKSPACE_SELECTED_HEADER } from '@b2b-saas-starter/auth'
import { McpClientConnections } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { listWorkspacesForUser } from '@b2b-saas-starter/capabilities/workspace-projections'
import { Effect, Schema } from 'effect'

import { causeMessage } from '../cause-message'
import { runCapabilities } from '../capabilities'
import { webRuntime } from '../observability'
import { type OAuthConsentPayload, type OAuthRedirect } from './mcp-consent'
import { sessionCall } from './plugin-call'

/**
 * The consent page's behaviour (ADR 0068), below the session gate.
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

/** Where the provider sends the browser next: its own URL string, plus the parsed view the flow inspects. */
type Redirect = {
  /** The provider's answer verbatim — handed to the page untouched. */
  readonly url: string
  /** Parsed against a synthetic base so relative answers can be inspected. */
  readonly parsed: URL
}

/** Absolute-or-relative, the provider's redirect target as a URL we can inspect. */
function redirect(result: typeof RedirectResult.Type): Redirect {
  return {
    url: result.url,
    parsed: new URL(result.url, 'http://oauth-redirect-base.invalid')
  }
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

/** The capability half of the consent payload; the server fn adds the request-read `oauthQuery`. */
type ConsentLoad = Omit<OAuthConsentPayload, 'oauthQuery'>

export function loadOAuthConsent(input: {
  readonly userId: string
  readonly clientId: string
}): Promise<ConsentLoad> {
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
  const continued = redirect(
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
  if (continued.parsed.pathname !== MCP_CONSENT_PAGE) {
    // A standing consent covered the request: the code was issued without a
    // new grant, so there is nothing new to audit.
    return { url: continued.url }
  }
  const consented = redirect(
    decodeRedirect(
      await sessionCall((api, headers) =>
        api.oauth2Consent({
          body: { accept: true, oauth_query: continued.parsed.search.slice(1) },
          headers,
          request: oauthRequest(headers)
        })
      )
    )
  )
  await recordGrantBestEffort(input, continued.parsed)
  return { url: consented.url }
}

/**
 * The `mcp_client.consent_granted` audit event, recorded **after** the
 * provider has already consented and issued the code. That ordering is why
 * this is best-effort: by the time it runs, the consent exists and the client
 * holds a working code, so a failed audit write must be reported and the user
 * still sent on their way — failing the redirect here would show "could not
 * be authorized" for an authorization that succeeded, and the plugin's own
 * write cannot be re-run to retry it. Same trade as the account hooks'
 * `reportDroppedAudit`: no ambient Effect survives the promise seam, so the
 * report goes to the isolate logger.
 */
async function recordGrantBestEffort(
  input: { readonly userId: string; readonly workspaceId: string },
  continued: URL
): Promise<void> {
  const clientId = continued.searchParams.get('client_id')
  if (clientId === null) {
    // The authorization request always names its client; recording a grant
    // for an unknown one would write a fake id into the audit trail, so this
    // is a defect, not a fallback.
    reportDroppedGrantAudit(
      `mcp consent grant audit dropped (no client_id on the consent hop, user ${input.userId}, workspace ${input.workspaceId})`
    )
    return
  }
  await runCapabilities(
    Effect.flatMap(McpClientConnections, (connections) =>
      connections.recordGrant({
        userId: input.userId,
        workspaceId: input.workspaceId,
        clientId,
        scopes: scopesOf(continued)
      })
    )
  ).catch(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the rejected value is a cause to log, not input to parse; `: unknown` is the safe annotation the audit-drop path demands
    (error: unknown) => {
      reportDroppedGrantAudit(
        `mcp consent grant audit dropped (client ${clientId}, user ${input.userId}, workspace ${input.workspaceId}): ${causeMessage(error, 'no reason given')}`
      )
    }
  )
}

/** The same visibility `reportDroppedAudit` gives the account hooks: a dropped audit write is never silent. */
function reportDroppedGrantAudit(message: string): void {
  void webRuntime.runPromise(Effect.logError(message))
}

export async function denyOAuthConsent(input: {
  readonly oauthQuery: string
}): Promise<OAuthRedirect> {
  const denied = redirect(
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
  return { url: denied.url }
}
