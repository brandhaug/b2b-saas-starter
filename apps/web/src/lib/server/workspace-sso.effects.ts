import { m } from '@b2b-saas-starter/i18n/messages'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import {
  SsoConnections,
  type SsoConnection,
  type SsoConnectionDetail,
  type SsoRoutingDecision
} from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect, Option, Result } from 'effect'

import { causeMessage } from '../cause-message'

import { runCapabilities, runWorkspaceCapabilities } from '../capabilities'
import { requestOrigin } from './request-origin'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { webSsoBinding } from './sso-binding'
import {
  resolveOidcIssuer,
  validateSamlMetadata,
  type SsoValidationError
} from './sso-discovery'
import {
  type CreateSsoConnectionInput,
  type RemoveSsoConnectionInput,
  type RoutingInput,
  type SsoTestResult,
  type UpdateSsoConnectionInput
} from './workspace-sso'

/**
 * The workspace SSO effects and their server-only wiring, reached only
 * through dynamic `import()` inside the handlers of `workspace-sso.ts` (see
 * apps/web/AGENTS.md for the split): each handler reads the session once,
 * then proves the actor may act inside the effect it hands to
 * `runWorkspaceCapabilities` — the permission gates, the create-time IdP
 * validation, and the notify-on-failure rule included.
 */

function samlIssuer(
  input: Extract<CreateSsoConnectionInput, { readonly protocol: 'saml' }>,
  metadata: string
): string {
  if (input.issuer !== undefined && input.issuer !== '') {
    return input.issuer
  }
  // The metadata's own entityID is the honest fallback when the form leaves
  // the issuer blank and no request origin is available (tests).
  const entityId = /entityID="([^"]+)"/.exec(metadata)?.[1]
  if (entityId !== undefined) {
    return entityId
  }
  return requestOrigin()
}

export async function createSsoConnectionHandler(
  input: CreateSsoConnectionInput
): Promise<SsoConnection> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      // The session gate above proves who is asking; this proves they may.
      yield* requireWorkspacePermission({ sso: ['create'] })
      const sso = yield* SsoConnections
      if (input.protocol === 'oidc') {
        // The live IdP check runs before the row exists, so a typo'd issuer is
        // refused at the form instead of as a broken connection to clean up.
        const endpoints = yield* resolveOidcIssuer(input.issuer)
        return yield* sso.create({
          protocol: 'oidc',
          domain: input.domain,
          issuer: input.issuer,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          endpoints,
          defaultWorkspaceRole: input.defaultWorkspaceRole
        })
      }
      const metadata = yield* loadSamlMetadata(input)
      const validated = yield* validateSamlMetadata(metadata)
      return yield* sso.create({
        protocol: 'saml',
        domain: input.domain,
        // The SP entity id defaults to the app origin when the form leaves it
        // blank: the plugin generates SP metadata from it, so it must be stable.
        issuer: samlIssuer(input, metadata),
        metadataXml: metadata,
        entryPoint: validated.entryPoint,
        defaultWorkspaceRole: input.defaultWorkspaceRole
      })
    }),
    { userId: session.user.id },
    { ssoBinding: webSsoBinding }
  )
}

/** A metadata URL is fetched once, at create; everything after stores the XML. */
function loadSamlMetadata(
  input: Extract<CreateSsoConnectionInput, { readonly protocol: 'saml' }>
): Effect.Effect<string, SsoValidationError> {
  if (input.metadataXml !== undefined) {
    return Effect.succeed(input.metadataXml)
  }
  const url = input.metadataUrl ?? ''
  // `causeMessage` is the repo's one unknown-throw reader, applied inline at
  // each catch boundary — no second representation is introduced here. The
  // two inline literals are the same error shape; `satisfies` pins both.
  return Effect.tryPromise({
    try: () => fetch(url, { redirect: 'follow' }),
    catch: (thrown) =>
      ({
        code: 'saml_metadata_invalid',
        message: causeMessage(thrown, m.server_metadata_fetch_failed())
      }) satisfies SsoValidationError
  }).pipe(
    Effect.flatMap((response) => {
      if (!response.ok) {
        return Effect.fail({
          code: 'saml_metadata_invalid',
          message: m.server_metadata_status({ status: response.status })
        } satisfies SsoValidationError)
      }
      return Effect.tryPromise({
        try: () => response.text(),
        catch: (thrown) =>
          ({
            code: 'saml_metadata_invalid',
            message: causeMessage(thrown, m.server_metadata_fetch_failed())
          }) satisfies SsoValidationError
      })
    })
  )
}

export async function updateSsoConnectionHandler(
  input: UpdateSsoConnectionInput
): Promise<SsoConnection | null> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ sso: ['update'] })
      const sso = yield* SsoConnections
      // Rest keeps the optional fields exactly as the schema decoded them — a
      // field the form did not send stays absent, and `undefined` means the
      // same thing to the capability.
      // oxlint-disable-next-line no-unused-vars -- rest exclusion: the slug routes the server fn, and the update payload must not carry it
      const { workspaceSlug, clientId, clientSecret, ...update } = input
      const updated = yield* sso.update({
        ...update,
        // Credential rotation is both-or-neither (the schema's filter proves
        // the pair); the plugin merges a partial oidcConfig over the stored
        // one, so a rotation replaces exactly the pair it names.
        oidcCredentials:
          clientId !== undefined && clientSecret !== undefined
            ? { clientId, clientSecret }
            : undefined
      })
      if (Option.isNone(updated)) {
        return null
      }
      return updated.value
    }),
    { userId: session.user.id },
    { ssoBinding: webSsoBinding }
  )
}

export async function removeSsoConnectionHandler(
  input: RemoveSsoConnectionInput
): Promise<boolean> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ sso: ['remove'] })
      const sso = yield* SsoConnections
      return yield* sso.remove({ providerId: input.providerId })
    }),
    { userId: session.user.id },
    { ssoBinding: webSsoBinding }
  )
}

/**
 * Tests one connection against its live IdP: OIDC by resolving the issuer's
 * discovery document, SAML by re-parsing the stored metadata. A failed test
 * notifies the workspace's owners — a broken SSO connection is exactly the
 * kind of thing an owner should hear about before sign-ins start failing —
 * and never fails the request that asked for the test: the verdict is the
 * answer, not an error.
 */
export async function testSsoConnectionHandler(
  input: RemoveSsoConnectionInput
): Promise<SsoTestResult> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ sso: ['update'] })
      const sso = yield* SsoConnections
      const detail = yield* sso.describe({ providerId: input.providerId })
      if (Option.isNone(detail)) {
        return failedTest('connection_not_found', m.server_sso_missing())
      }
      const connection = detail.value
      const verdict = yield* Effect.result(connectionCheck(connection))
      if (Result.isFailure(verdict)) {
        yield* notifyOwnersOfFailedTest(connection, verdict.failure.code)
        return failedTest(verdict.failure.code, verdict.failure.message)
      }
      return { outcome: 'passed' } satisfies SsoTestResult
    }),
    { userId: session.user.id }
  )
}

/** The live IdP check one stored connection answers to. */
function connectionCheck(
  connection: SsoConnectionDetail
): Effect.Effect<void, SsoValidationError> {
  if (connection.protocol === 'oidc') {
    if (connection.oidc === null) {
      return missingConfig(m.server_sso_endpoints_missing())
    }
    return Effect.asVoid(resolveOidcIssuer(connection.issuer))
  }
  if (connection.saml === null) {
    return missingConfig(m.server_sso_metadata_missing())
  }
  return Effect.asVoid(validateSamlMetadata(connection.saml.metadataXml))
}

function missingConfig(message: string): Effect.Effect<void, SsoValidationError> {
  return Effect.fail({ code: 'discovery_invalid', message })
}

function failedTest(code: string, message: string): SsoTestResult {
  return { outcome: 'failed', code, message } satisfies SsoTestResult
}

/**
 * The owner fan-out behind a failed connection test: every owner on the
 * roster gets one notification naming the domain and the reason, and nobody
 * else does. Exported beside the handler because the handler seam cannot
 * stage or observe a Seed feed across a call — this is where the rule is
 * testable.
 */
export function notifyOwnersOfFailedTest(
  connection: SsoConnection,
  reasonCode: string
): Effect.Effect<
  void,
  CapabilityUnavailable,
  WorkspaceContext | WorkspaceMembership | NotificationFeed
> {
  return Effect.gen(function* () {
    const membership = yield* WorkspaceMembership
    const feed = yield* NotificationFeed
    const members = yield* membership.listMembers
    const owners = members.filter((member) => member.role === 'owner')
    yield* Effect.forEach(owners, (owner) =>
      feed.record({
        title: 'SSO connection failed its test',
        message: `The ${connection.protocol.toUpperCase()} connection for ${connection.domain} failed: ${reasonCode}`,
        event: {
          type: 'sso.test_failed',
          protocol: connection.protocol,
          domain: connection.domain,
          reasonCode
        },
        userId: owner.id
      })
    )
  })
}

/**
 * The sign-in page's routing ask: does this email's domain belong to an
 * enabled connection? Deliberately **not** session-gated — the asker is on
 * the public sign-in page — and it discloses nothing beyond the fact that the
 * domain routes, which the IdP redirect discloses anyway.
 */
export async function resolveSsoRoutingHandler(
  input: RoutingInput
): Promise<SsoRoutingDecision | null> {
  const decision = await runCapabilities(
    Effect.flatMap(SsoConnections, (sso) => sso.resolveRouting(input.email))
  )
  return Option.isSome(decision) ? decision.value : null
}
