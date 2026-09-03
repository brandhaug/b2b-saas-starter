import {
  AuditEventLog,
  type RecordAuditEventInput
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { SsoConnections } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { Auth } from '@b2b-saas-starter/auth'
import { Effect, Option, type Scope } from 'effect'

import { authRuntime } from '../../auth-runtime'
import { runCapabilities } from '../../capabilities'
import { withWebRequestScope } from '../../observability'
import { type RunAuditCapabilities } from './shared'

/**
 * The SSO sign-in audit (ADR 0054) — the exchange-table rows cannot express
 * it: the callback endpoints answer with a redirect whose body names nobody,
 * and the event is *workspace-scoped* (the connection's), while every
 * `EXCHANGE_ROWS` event is system-level with `workspaceId: null`.
 *
 * So this is a small sibling of `record.ts`, on the same best-effort
 * contract: after the auth handler answers, an SSO callback whose redirect
 * carries no `error` records `auth.sso_sign_in`, attributed by reading the
 * session cookie the response just set; a redirect carrying an error records
 * `auth.sso_sign_in_failed`, unattributed (there is no session to read).
 * A failure of the audit itself annotates the caller's wide event — it never
 * fails the auth response.
 */

/** The SSO callback shapes: OIDC redirect-back and the SAML ACS. */
export function ssoCallbackProviderId(exchange: {
  readonly method: string
  readonly pathname: string
}): string | null {
  const oidc = /\/api\/auth\/sso\/callback\/([^/]+)$/.exec(exchange.pathname)
  if (oidc !== null) {
    return decodeURIComponent(oidc[1] ?? '')
  }
  const acs = /\/api\/auth\/sso\/saml2\/sp\/acs\/([^/]+)$/.exec(exchange.pathname)
  if (acs !== null) {
    return decodeURIComponent(acs[1] ?? '')
  }
  return null
}

/** The session token Better Auth set on the response, as a cookie header. */
function responseSessionCookie(response: Response): string | null {
  const pairs: Array<string> = []
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0]
    if (cookie.includes('session_token') && pair !== undefined) {
      pairs.push(pair)
    }
  }
  if (pairs.length === 0) {
    return null
  }
  return pairs.join('; ')
}

/** A redirect without an `error` param is the plugin's success shape. */
function callbackFailed(response: Response): boolean {
  if (response.status >= 400) {
    return true
  }
  const location = response.headers.get('location')
  if (location === null) {
    return false
  }
  return URL.parse(location)?.searchParams.has('error') ?? true
}

export function recordSsoSignInAudit(
  exchange: { readonly method: string; readonly pathname: string },
  response: Response,
  run: RunAuditCapabilities = runCapabilities
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const providerId = ssoCallbackProviderId(exchange)
    if (providerId === null) {
      return
    }

    // The workspace the connection belongs to scopes the event; an unknown
    // provider (a row deleted mid-flight, or a capability hiccup) still
    // records, unscoped — the `then` fallback folds a rejection into null.
    const workspaceId = yield* Effect.promise(() =>
      runCapabilities(
        Effect.flatMap(SsoConnections, (sso) => sso.resolveProvider(providerId))
      ).then(
        (provider) => (Option.isSome(provider) ? provider.value.workspaceId : null),
        () => null
      )
    )

    if (callbackFailed(response)) {
      yield* writeAndReport(run, {
        workspaceId,
        actorUserId: null,
        eventType: 'auth.sso_sign_in_failed',
        targetType: 'session',
        targetId: null,
        metadata: { providerId, statusCode: response.status }
      })
      return
    }

    // Success: attribute the event to the user the response just signed in.
    const cookie = responseSessionCookie(response)
    if (cookie === null) {
      return
    }
    const attributed = yield* Effect.promise(() => readResponseSession(cookie))
    if (attributed === null) {
      return
    }
    yield* writeAndReport(run, {
      workspaceId,
      actorUserId: attributed.userId,
      eventType: 'auth.sso_sign_in',
      targetType: 'session',
      targetId: attributed.sessionId,
      metadata: { providerId }
    })
  })
}

/** The actor an SSO callback's response signed in, read from the cookie it set. */
function readResponseSession(cookie: string): Promise<{
  readonly userId: string
  readonly sessionId: string
} | null> {
  return (
    authRuntime
      .runPromise(
        withWebRequestScope(
          { event: 'auth.sso_session' },
          Effect.flatMap(Auth.Tag, (auth) =>
            auth.api.getSession({ headers: new Headers({ cookie }) })
          )
        )
      )
      .then((session) =>
        session ? { userId: session.user.id, sessionId: session.session.id } : null
      )
      // A failed session read records nothing rather than failing the exchange;
      // the wide event already carries the callback's outcome.
      .catch(() => null)
  )
}

/**
 * Best-effort by contract (a D1 hiccup must not fail an auth response the
 * plugin already answered): the write is attempted, its failure annotated on
 * the wide event the caller is inside.
 */
function writeAndReport(
  run: RunAuditCapabilities,
  input: RecordAuditEventInput
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const failed = yield* Effect.promise(() =>
      run(Effect.flatMap(AuditEventLog, (audit) => audit.record(input))).then(
        () => false,
        () => true
      )
    )
    if (failed) {
      yield* Effect.annotateLogsScoped({ ssoAuditError: 'write_failed' })
    }
  })
}
