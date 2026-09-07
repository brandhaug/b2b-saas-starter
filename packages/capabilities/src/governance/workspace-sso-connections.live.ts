import {
  workspaceSsoConnections,
  workspaceSsoDomainClaims,
  workspaceMembers,
  passkey,
  user,
  account
} from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { DateTime, Effect, Layer, Option, Schema } from 'effect'
import { and, desc, eq, gt, or, sql } from 'drizzle-orm'

import { MembershipChangeRejected } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog, recordInWorkspace } from './audit-event-log.ts'
import { makeBindingCaller } from './plugin-binding-failure.ts'
import { makeSsoDomainVerification } from './sso-domain-verification.live.ts'
import { normalizeSsoDomain } from './sso-policy.ts'
import { type SsoPolicyOptions } from './sso-policy-config.ts'
import { auditedMutations } from './audited-mutation.ts'
import { requireRecentSsoConfigurationAuth } from './sso-configuration-auth.ts'
import {
  pickSignInTarget,
  requireProtocolMatch,
  requireSafeSsoTransition,
  SsoConnections,
  ssoAuditEvent,
  toRoutingDecision,
  type SsoConnection,
  type SsoConnectionDetail,
  type SsoRoutingFields,
  type WorkspaceSsoBinding
} from './workspace-sso-connections.ts'

const { callBinding } = makeBindingCaller<
  WorkspaceSsoBinding,
  MembershipChangeRejected
>({
  capability: 'workspace-sso-connections',
  noBindingReason: 'no_sso_binding',
  Rejected: MembershipChangeRejected
})

type ConnectionRow = typeof workspaceSsoConnections.$inferSelect

/**
 * What a stored config blob may hold, whichever protocol. Parsing through a
 * schema (not `JSON.parse` + probing) is the boundary: a malformed blob
 * degrades to `None` — "no config read" — rather than failing the whole
 * list, and the secret never leaves this module's Option.
 */
const StoredConfig = Schema.Struct({
  clientId: Schema.optional(Schema.String),
  authorizationEndpoint: Schema.optional(Schema.String),
  tokenEndpoint: Schema.optional(Schema.String),
  jwksEndpoint: Schema.optional(Schema.String),
  userInfoEndpoint: Schema.optional(Schema.String),
  entryPoint: Schema.optional(Schema.String),
  idpMetadata: Schema.optional(
    Schema.Struct({ metadata: Schema.optional(Schema.String) })
  )
})

const StoredConfigJson = Schema.fromJsonString(StoredConfig)
const readStoredConfig = Schema.decodeUnknownOption(StoredConfigJson)

function storedConfig(raw: string | null): Option.Option<typeof StoredConfig.Type> {
  if (raw === null) {
    return Option.none()
  }
  return readStoredConfig(raw)
}

/** The wire protocol a stored row speaks, decided once. */
function protocolOf(row: { readonly samlConfig: string | null }): 'oidc' | 'saml' {
  if (row.samlConfig === null) {
    return 'oidc'
  }
  return 'saml'
}

/** The routing fields the shared sign-in resolution reads off a stored row. */
function routingFields(row: ConnectionRow): SsoRoutingFields {
  return {
    id: row.providerId,
    protocol: protocolOf(row),
    domain: row.domain,
    workspaceId: row.workspaceId,
    enabled: row.enabled,
    requireSso: row.requireSso
  }
}

/**
 * Maps a stored row onto the wire DTO. The config blob is parsed for the
 * client id's last four only — the secret and every other config value stay
 * behind this boundary, which is what "secrets are write-only" means in
 * practice: no read path composes them.
 */
function toConnection(row: ConnectionRow): SsoConnection {
  const config = storedConfig(row.oidcConfig)
  let clientIdLastFour: string | null = null
  if (Option.isSome(config) && config.value.clientId !== undefined) {
    clientIdLastFour = config.value.clientId.slice(-4)
  }
  return {
    id: row.providerId,
    protocol: protocolOf(row),
    domain: row.domain,
    issuer: row.issuer,
    enabled: row.enabled,
    requireSso: row.requireSso,
    domainVerified: row.domainVerified,
    autoJoin: row.autoJoin,
    lastLoginTestedAt: row.lastLoginTestedAt?.toISOString() ?? null,
    defaultWorkspaceRole: row.defaultWorkspaceRole,
    clientIdLastFour,
    createdAt: row.createdAt.toISOString()
  }
}

/** The OIDC half of `describe`, when the stored blob carries full endpoints. */
function oidcDetail(
  config: Option.Option<typeof StoredConfig.Type>
): SsoConnectionDetail['oidc'] {
  if (Option.isNone(config)) {
    return null
  }
  const parsed = config.value
  if (
    parsed.authorizationEndpoint === undefined ||
    parsed.tokenEndpoint === undefined ||
    parsed.jwksEndpoint === undefined
  ) {
    return null
  }
  return {
    authorizationEndpoint: parsed.authorizationEndpoint,
    tokenEndpoint: parsed.tokenEndpoint,
    jwksEndpoint: parsed.jwksEndpoint,
    userInfoEndpoint: parsed.userInfoEndpoint ?? null
  }
}

/** The SAML half of `describe`, when the stored blob carries the metadata. */
function samlDetail(
  config: Option.Option<typeof StoredConfig.Type>
): SsoConnectionDetail['saml'] {
  if (Option.isNone(config)) {
    return null
  }
  const parsed = config.value
  if (parsed.entryPoint === undefined || parsed.idpMetadata === undefined) {
    return null
  }
  if (parsed.idpMetadata.metadata === undefined) {
    return null
  }
  return {
    metadataXml: parsed.idpMetadata.metadata,
    entryPoint: parsed.entryPoint
  }
}

/**
 * The connection plus its testable protocol detail. A config blob that does
 * not parse (or lacks the endpoints) contributes a `null` segment rather than
 * failing the read — the test step reports the gap, the list still renders.
 * The protocol is decided once and only its own blob is parsed.
 */
function toDetail(row: ConnectionRow): SsoConnectionDetail {
  const protocol = protocolOf(row)
  if (protocol === 'saml') {
    const config = storedConfig(row.samlConfig)
    return { ...toConnection(row), oidc: null, saml: samlDetail(config) }
  }
  const config = storedConfig(row.oidcConfig)
  return { ...toConnection(row), oidc: oidcDetail(config), saml: null }
}

export function LiveSsoConnections(
  binding?: WorkspaceSsoBinding,
  options: SsoPolicyOptions = {}
): Layer.Layer<SsoConnections, never, Database | RawD1 | AuditEventLog> {
  return Layer.effect(SsoConnections)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog
      const unavailable = orUnavailable('workspace-sso-connections')
      const domains = yield* makeSsoDomainVerification(binding, options)
      const mutate = yield* auditedMutations({
        prepareAuditRecord: audit.prepareRecord,
        unavailable
      })

      /**
       * The connection read back through the same table `list` reads, scoped
       * to the workspace in context — never the plugin's response, which is
       * exactly the shape this package refuses to name.
       */
      const readInWorkspace = Effect.fnUntraced(function* (
        workspaceId: string,
        providerId: string
      ) {
        const rows = yield* unavailable(
          db
            .select()
            .from(workspaceSsoConnections)
            .where(
              and(
                eq(workspaceSsoConnections.workspaceId, workspaceId),
                eq(workspaceSsoConnections.providerId, providerId)
              )
            )
            .limit(1)
        )
        return Option.fromNullishOr(rows[0])
      })

      return {
        ...domains,
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select()
              .from(workspaceSsoConnections)
              .where(eq(workspaceSsoConnections.workspaceId, ctx.workspace.id))
              .orderBy(desc(workspaceSsoConnections.createdAt))
          )
          return rows.map(toConnection)
        }),
        get: ({ providerId }) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const row = yield* readInWorkspace(ctx.workspace.id, providerId)
            return Option.map(row, toConnection)
          }),
        describe: ({ providerId }) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const row = yield* readInWorkspace(ctx.workspace.id, providerId)
            return Option.map(row, toDetail)
          }),
        create: (input) =>
          Effect.gen(function* () {
            yield* requireRecentSsoConfigurationAuth(
              db,
              options.configurationAuthRecencyMs
            )
            const ctx = yield* WorkspaceContext
            const domain = normalizeSsoDomain(input.domain)
            if (domain === undefined) {
              return yield* new MembershipChangeRejected({
                reason: 'invalid_sso_domain'
              })
            }
            if (input.defaultWorkspaceRole !== 'member') {
              return yield* new MembershipChangeRejected({
                reason: 'sso_member_role_only'
              })
            }
            const providerId = yield* newCapabilityId('sso')
            yield* callBinding(binding, (bound) =>
              bound.create({
                ...input,
                domain,
                workspaceId: ctx.workspace.id,
                providerId
              })
            )
            const row = yield* readInWorkspace(ctx.workspace.id, providerId)
            if (Option.isNone(row)) {
              return yield* Effect.fail(
                new MembershipChangeRejected({ reason: 'connection_not_created' })
              )
            }
            const connection = toConnection(row.value)
            yield* recordInWorkspace(audit, {
              ...ssoAuditEvent('created', connection),
              targetId: connection.id
            })
            return connection
          }),
        update: (input) =>
          Effect.gen(function* () {
            yield* requireRecentSsoConfigurationAuth(
              db,
              options.configurationAuthRecencyMs
            )
            const ctx = yield* WorkspaceContext
            const existing = yield* readInWorkspace(ctx.workspace.id, input.providerId)
            if (Option.isNone(existing)) {
              return Option.none<SsoConnection>()
            }
            yield* requireProtocolMatch(toConnection(existing.value), input)
            const previous = existing.value
            yield* requireSafeSsoTransition(toConnection(previous), input)
            if (
              input.enabled === true ||
              input.requireSso === true ||
              input.autoJoin === true
            ) {
              const [claim] = yield* unavailable(
                db
                  .select()
                  .from(workspaceSsoDomainClaims)
                  .where(
                    and(
                      eq(workspaceSsoDomainClaims.domain, previous.domain),
                      eq(workspaceSsoDomainClaims.workspaceId, ctx.workspace.id),
                      eq(workspaceSsoDomainClaims.status, 'verified')
                    )
                  )
                  .limit(1)
              )
              if (!claim) {
                return yield* new MembershipChangeRejected({
                  reason: 'domain_verification_required'
                })
              }
            }
            let replaced: ConnectionRow | undefined
            if (input.replaceProviderId !== undefined) {
              const predecessor = yield* readInWorkspace(
                ctx.workspace.id,
                input.replaceProviderId
              )
              if (
                Option.isNone(predecessor) ||
                predecessor.value.providerId === previous.providerId ||
                input.enabled !== true
              ) {
                return yield* new MembershipChangeRejected({
                  reason: 'invalid_sso_replacement'
                })
              }
              replaced = predecessor.value
            }
            const requireSso =
              input.requireSso ?? replaced?.requireSso ?? previous.requireSso
            yield* requireSafeSsoTransition(toConnection(previous), {
              ...input,
              requireSso
            })
            if (requireSso) {
              const owners = yield* unavailable(
                db
                  .select({ userId: user.id, mfa: user.twoFactorEnabled })
                  .from(workspaceMembers)
                  .innerJoin(user, eq(user.id, workspaceMembers.userId))
                  .where(
                    and(
                      eq(workspaceMembers.workspaceId, ctx.workspace.id),
                      eq(workspaceMembers.role, 'owner')
                    )
                  )
              )
              let recoveryReady = false
              for (const owner of owners) {
                const factors = yield* unavailable(
                  db
                    .select({ id: passkey.id })
                    .from(passkey)
                    .where(eq(passkey.userId, owner.userId))
                    .limit(1)
                )
                const passwords = yield* unavailable(
                  db
                    .select({ password: account.password })
                    .from(account)
                    .where(
                      and(
                        eq(account.userId, owner.userId),
                        eq(account.providerId, 'credential')
                      )
                    )
                    .limit(1)
                )
                if (factors.length > 0 || (owner.mfa && passwords[0]?.password)) {
                  recoveryReady = true
                }
              }
              if (!recoveryReady) {
                return yield* new MembershipChangeRejected({
                  reason: 'sso_recovery_factor_required'
                })
              }
            }
            if (input.oidcCredentials !== undefined) {
              yield* callBinding(binding, (bound) =>
                bound.update({
                  providerId: input.providerId,
                  oidcCredentials: input.oidcCredentials
                })
              )
            }
            const invalidated =
              input.enabled === false || input.oidcCredentials !== undefined
            const changed = {
              enabled: input.enabled ?? previous.enabled,
              requireSso,
              autoJoin: input.autoJoin ?? previous.autoJoin,
              defaultWorkspaceRole: 'member',
              connectionGeneration: previous.connectionGeneration + 1,
              lastLoginTestedAt: previous.lastLoginTestedAt,
              lastLoginTestedBy: previous.lastLoginTestedBy
            } satisfies Partial<ConnectionRow>
            if (invalidated) {
              changed.lastLoginTestedAt = null
              changed.lastLoginTestedBy = null
            }
            yield* mutate({
              matched: Effect.succeed(true),
              auditEvent: {
                workspaceId: ctx.workspace.id,
                actorUserId: ctx.actor?.userId ?? null,
                actorType: ctx.actorType,
                eventType: 'workspace_sso.connection_updated',
                targetType: 'workspace_sso_connection',
                targetId: input.providerId,
                metadata: {
                  enabled: changed.enabled,
                  requireSso,
                  autoJoin: changed.autoJoin,
                  replacedProviderId: replaced?.providerId ?? null
                }
              },
              write: () => {
                const writes = []
                let predecessorRetired
                if (replaced !== undefined) {
                  predecessorRetired = sql`exists (select 1 from workspace_sso_connections predecessor where predecessor.providerId = ${replaced.providerId} and predecessor.connectionGeneration = ${replaced.connectionGeneration + 1} and predecessor.enabled = 0 and predecessor.requireSso = 0)`
                }
                if (replaced) {
                  writes.push(
                    db
                      .update(workspaceSsoConnections)
                      .set({
                        enabled: false,
                        requireSso: false,
                        lastLoginTestedAt: null,
                        lastLoginTestedBy: null,
                        connectionGeneration: sql`${workspaceSsoConnections.connectionGeneration} + 1`
                      })
                      .where(
                        and(
                          eq(workspaceSsoConnections.providerId, replaced.providerId),
                          eq(workspaceSsoConnections.workspaceId, ctx.workspace.id),
                          eq(
                            workspaceSsoConnections.connectionGeneration,
                            replaced.connectionGeneration
                          ),
                          sql`exists (select 1 from workspace_sso_connections candidate where candidate.providerId = ${previous.providerId} and candidate.connectionGeneration = ${previous.connectionGeneration})`
                        )
                      )
                  )
                }
                writes.push(
                  db
                    .update(workspaceSsoConnections)
                    .set(changed)
                    .where(
                      and(
                        eq(workspaceSsoConnections.providerId, previous.providerId),
                        eq(workspaceSsoConnections.workspaceId, ctx.workspace.id),
                        eq(
                          workspaceSsoConnections.connectionGeneration,
                          previous.connectionGeneration
                        ),
                        predecessorRetired
                      )
                    )
                )
                return writes
              }
            })
            const row = yield* readInWorkspace(ctx.workspace.id, input.providerId)
            const connection = Option.map(row, toConnection)
            return connection
          }),
        remove: ({ providerId }) =>
          Effect.gen(function* () {
            yield* requireRecentSsoConfigurationAuth(
              db,
              options.configurationAuthRecencyMs
            )
            const ctx = yield* WorkspaceContext
            const existing = yield* readInWorkspace(ctx.workspace.id, providerId)
            if (Option.isNone(existing)) {
              return false
            }
            const connection = toConnection(existing.value)
            if (connection.requireSso) {
              return yield* new MembershipChangeRejected({
                reason: 'disable_sso_requirement_first'
              })
            }
            yield* callBinding(binding, (bound) => bound.remove({ providerId }))
            yield* recordInWorkspace(audit, {
              ...ssoAuditEvent('removed', connection),
              targetId: connection.id
            })
            return true
          }),
        resolveRouting: (email) =>
          Effect.gen(function* () {
            // Only enabled connections route — a disabled row persists for the
            // settings UI without intercepting sign-ins (the seeded example
            // connection depends on exactly this; the auth gate enforces the
            // same rule for direct `/sign-in/sso` calls).
            const now = DateTime.formatIso(yield* DateTime.now)
            const rows = yield* unavailable(
              db
                .select({ connection: workspaceSsoConnections })
                .from(workspaceSsoConnections)
                .innerJoin(
                  workspaceSsoDomainClaims,
                  and(
                    eq(workspaceSsoDomainClaims.domain, workspaceSsoConnections.domain),
                    eq(
                      workspaceSsoDomainClaims.workspaceId,
                      workspaceSsoConnections.workspaceId
                    )
                  )
                )
                .where(
                  and(
                    eq(workspaceSsoConnections.enabled, true),
                    eq(workspaceSsoConnections.domainVerified, true),
                    or(
                      eq(workspaceSsoDomainClaims.status, 'verified'),
                      and(
                        eq(workspaceSsoDomainClaims.status, 'grace'),
                        gt(workspaceSsoDomainClaims.graceUntil, now)
                      )
                    )
                  )
                )
            )
            return Option.map(
              Option.fromNullishOr(
                pickSignInTarget(
                  rows.map((row) => routingFields(row.connection)),
                  { email }
                )
              ),
              toRoutingDecision
            )
          }),
        resolveSignInTarget: (input) =>
          Effect.gen(function* () {
            // Deliberately unfiltered by `enabled`: the gate needs to see a
            // disabled resolution to refuse it.
            const rows = yield* unavailable(db.select().from(workspaceSsoConnections))
            return Option.fromNullishOr(
              pickSignInTarget(rows.map(routingFields), input)
            )
          }),
        resolveProvider: (providerId) =>
          Effect.gen(function* () {
            const rows = yield* unavailable(
              db
                .select({
                  workspaceId: workspaceSsoConnections.workspaceId,
                  domain: workspaceSsoConnections.domain
                })
                .from(workspaceSsoConnections)
                .where(eq(workspaceSsoConnections.providerId, providerId))
                .limit(1)
            )
            return Option.fromNullishOr(rows[0])
          })
      }
    })
  )
}
