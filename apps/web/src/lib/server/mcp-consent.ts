import { type McpClientSummary } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { type WorkspaceListItemProjection } from '@b2b-saas-starter/capabilities/workspace-projections'
import { createServerFn } from '@tanstack/react-start'

import { requireRequestSession } from './auth'
import { signedOAuthQuery } from '../oauth-query'
import { currentRequest } from '../request-context'

/**
 * Server functions for the OAuth consent page (ADR 0068): declarations only.
 * The behaviour — the Better Auth endpoint calls that turn a workspace pick
 * into a consent and an authorization code — lives in `mcp-consent.effects.ts`
 * and is reached through dynamic `import()`, so the route tree never carries
 * the auth server into the browser bundle (the same split
 * `invitations.ts` / `invitations.effects.ts` uses). The validators below
 * are the only decode these inputs get: TanStack Start strips
 * `.validator()` from the client build and runs it on the server only, so
 * the plain string checks are the server-side boundary, and
 * `mcp-consent.effects.ts` trusts their output without re-decoding — the
 * whole constraint, empty strings rejected on the workspace pick and the
 * signed query, is stated right there. Plain checks (no Effect Schema) keep
 * the module cheap for the route tree to carry.
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

type LoadInput = { readonly clientId: string }

type GrantInput = {
  readonly workspaceId: string
  /** The page's signed OAuth query (`signedOAuthQuery` in `lib/oauth-query.ts`). */
  readonly oauthQuery: string
}

type DenyInput = { readonly oauthQuery: string }

/**
 * The server fns' validators, plain string checks that run server-side only
 * (TanStack strips `.validator()` from the client build): they are the
 * server's first decode and — the consent effects re-decode nothing — the
 * whole constraint. These probes ARE the I/O boundary, so `unknown` in and
 * `throw` out is the contract, the same exemption `pickOptionalStrings`
 * carries (lib/utils.ts).
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, effect/noThrowStatement, effect/noNewError, unicorn/prefer-type-error
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function inputString(value: unknown, key: string): string {
  if (!isRecord(value)) {
    throw new Error('Invalid consent input')
  }
  const field = value[key]
  if (typeof field !== 'string') {
    throw new Error(`Invalid consent input: ${key}`)
  }
  return field
}

function inputNonEmptyString(value: unknown, key: string): string {
  const field = inputString(value, key)
  if (field.length === 0) {
    throw new Error(`Invalid consent input: ${key}`)
  }
  return field
}

function decodeLoadInput(input: unknown): LoadInput {
  return { clientId: inputString(input, 'clientId') }
}

function decodeGrantInput(input: unknown): GrantInput {
  return {
    workspaceId: inputNonEmptyString(input, 'workspaceId'),
    oauthQuery: inputNonEmptyString(input, 'oauthQuery')
  }
}

function decodeDenyInput(input: unknown): DenyInput {
  return { oauthQuery: inputNonEmptyString(input, 'oauthQuery') }
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, effect/noThrowStatement, effect/noNewError, unicorn/prefer-type-error

export const loadOAuthConsentServerFn = createServerFn({ method: 'GET' })
  .validator(decodeLoadInput)
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

export const grantOAuthConsentServerFn = createServerFn({ method: 'POST' })
  .validator(decodeGrantInput)
  .handler(async ({ data }): Promise<OAuthRedirect> => {
    const session = await requireRequestSession()
    const { grantOAuthConsent } = await import('./mcp-consent.effects')
    return grantOAuthConsent({
      userId: session.user.id,
      workspaceId: data.workspaceId,
      oauthQuery: data.oauthQuery
    })
  })

export const denyOAuthConsentServerFn = createServerFn({ method: 'POST' })
  .validator(decodeDenyInput)
  .handler(async ({ data }): Promise<OAuthRedirect> => {
    await requireRequestSession()
    const { denyOAuthConsent } = await import('./mcp-consent.effects')
    return denyOAuthConsent({ oauthQuery: data.oauthQuery })
  })
