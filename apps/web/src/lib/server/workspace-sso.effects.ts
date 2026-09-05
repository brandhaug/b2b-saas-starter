import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import {
  type CapabilityUnavailable,
  type MembershipChangeRejected
} from '@b2b-saas-starter/capabilities/errors'
import {
  SsoConnections,
  type SsoConnection,
  type SsoConnectionDetail,
  type SsoRoutingDecision
} from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect, Option, Result, type Scope } from 'effect'

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
 * apps/web/AGENTS.md for the split): the effects take their inputs as
 * arguments so the permission gates and the notify-on-failure rule are
 * testable without a session or an auth runtime; each `…Handler` adds the
 * session gate, the request origin and the plugin binding, nothing else.
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

export function createSsoConnection(
  input: CreateSsoConnectionInput
): Effect.Effect<
  SsoConnection,
  | AuthorizationDenied
  | CapabilityUnavailable
  | MembershipChangeRejected
  | SsoValidationError,
  Scope.Scope | WorkspaceContext | SsoConnections
> {
  return Effect.gen(function* () {
    // The session gate in the server function proves who is asking; this
    // proves they may.
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
  })
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
        message: causeMessage(thrown, 'The metadata could not be fetched')
      }) satisfies SsoValidationError
  }).pipe(
    Effect.flatMap((response) => {
      if (!response.ok) {
        return Effect.fail({
          code: 'saml_metadata_invalid',
          message: `The metadata URL answered ${response.status}`
        } satisfies SsoValidationError)
      }
      return Effect.tryPromise({
        try: () => response.text(),
        catch: (thrown) =>
          ({
            code: 'saml_metadata_invalid',
            message: causeMessage(thrown, 'The metadata could not be fetched')
          }) satisfies SsoValidationError
      })
    })
  )
}

export async function createSsoConnectionHandler(
  input: CreateSsoConnectionInput
): Promise<SsoConnection> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    createSsoConnection(input),
    { userId: session.user.id },
    { ssoBinding: webSsoBinding }
  )
}

export function updateSsoConnection(
  input: UpdateSsoConnectionInput
): Effect.Effect<
  SsoConnection | null,
  AuthorizationDenied | CapabilityUnavailable | MembershipChangeRejected,
  Scope.Scope | WorkspaceContext | SsoConnections
> {
  return Effect.gen(function* () {
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
  })
}

export async function updateSsoConnectionHandler(
  input: UpdateSsoConnectionInput
): Promise<SsoConnection | null> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    updateSsoConnection(input),
    { userId: session.user.id },
    { ssoBinding: webSsoBinding }
  )
}

export function removeSsoConnection(input: {
  readonly providerId: string
}): Effect.Effect<
  boolean,
  AuthorizationDenied | CapabilityUnavailable | MembershipChangeRejected,
  Scope.Scope | WorkspaceContext | SsoConnections
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ sso: ['remove'] })
    const sso = yield* SsoConnections
    return yield* sso.remove({ providerId: input.providerId })
  })
}

export async function removeSsoConnectionHandler(
  input: RemoveSsoConnectionInput
): Promise<boolean> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    removeSsoConnection({ providerId: input.providerId }),
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
export function testSsoConnection(input: {
  readonly providerId: string
}): Effect.Effect<
  SsoTestResult,
  AuthorizationDenied | CapabilityUnavailable,
  | Scope.Scope
  | WorkspaceContext
  | SsoConnections
  | WorkspaceMembership
  | NotificationFeed
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ sso: ['update'] })
    const sso = yield* SsoConnections
    const detail = yield* sso.describe({ providerId: input.providerId })
    if (Option.isNone(detail)) {
      return failedTest('connection_not_found', 'No such connection in this workspace')
    }
    const connection = detail.value
    const verdict = yield* Effect.result(connectionCheck(connection))
    if (Result.isFailure(verdict)) {
      yield* notifyOwnersOfFailedTest(connection, verdict.failure.message)
      return failedTest(verdict.failure.code, verdict.failure.message)
    }
    return { outcome: 'passed' } satisfies SsoTestResult
  })
}

/** The live IdP check one stored connection answers to. */
function connectionCheck(
  connection: SsoConnectionDetail
): Effect.Effect<void, SsoValidationError> {
  if (connection.protocol === 'oidc') {
    if (connection.oidc === null) {
      return missingConfig('The stored connection has no resolved endpoints')
    }
    return Effect.asVoid(resolveOidcIssuer(connection.issuer))
  }
  if (connection.saml === null) {
    return missingConfig('The stored connection has no IdP metadata')
  }
  return Effect.asVoid(validateSamlMetadata(connection.saml.metadataXml))
}

function missingConfig(message: string): Effect.Effect<void, SsoValidationError> {
  return Effect.fail({ code: 'discovery_invalid', message })
}

function failedTest(code: string, message: string): SsoTestResult {
  return { outcome: 'failed', code, message } satisfies SsoTestResult
}

function notifyOwnersOfFailedTest(
  connection: SsoConnection,
  reason: string
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
        message: `The ${connection.protocol.toUpperCase()} connection for ${connection.domain} failed: ${reason}`,
        userId: owner.id
      })
    )
  })
}

export async function testSsoConnectionHandler(
  input: RemoveSsoConnectionInput
): Promise<SsoTestResult> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(input.workspaceSlug, testSsoConnection(input), {
    userId: session.user.id
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
