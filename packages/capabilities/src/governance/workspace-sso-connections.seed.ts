import { DateTime, Effect, Layer, Option } from 'effect'

import { type CapabilityUnavailable, MembershipChangeRejected } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog, type AuditEventLogInterface } from './audit-event-log.ts'
import {
  matchesEmailDomain,
  SsoConnections,
  type CreateSsoConnectionInput,
  type SsoConnection,
  type SsoConnectionDetail,
  type SsoRoutingDecision
} from './workspace-sso-connections.ts'

/**
 * Seed rows carry the workspace id so `resolveRouting` — which has no
 * `WorkspaceContext` to read one from — can still answer. It is stripped from
 * the DTO, same as `SeedNotification.userId`. The optional protocol detail
 * mirrors what Live parses out of the stored config blobs; a fixture without
 * it describes its connection with `null` segments, which the test step
 * reports like a config gap.
 */
export type SeedSsoConnection = SsoConnection & {
  readonly workspaceId: string
  readonly oidc?: SsoConnectionDetail['oidc'] | undefined
  readonly saml?: SsoConnectionDetail['saml'] | undefined
}

export function SeedSsoConnections(
  seed: ReadonlyArray<SeedSsoConnection>
): Layer.Layer<SsoConnections, never, AuditEventLog> {
  // A private copy: mutations append here without mutating the caller's
  // fixture array, matching `SeedAuditEventLog`'s contract.
  const rows: Array<SeedSsoConnection> = [...seed]
  return Layer.effect(SsoConnections)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog

      const findInWorkspace = Effect.fnUntraced(function* (providerId: string) {
        const ctx = yield* WorkspaceContext
        return rows.find(
          (candidate) =>
            candidate.id === providerId && candidate.workspaceId === ctx.workspace.id
        )
      })

      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const visible: Array<SsoConnection> = []
          for (const row of rows) {
            if (row.workspaceId === ctx.workspace.id) {
              visible.push(toDto(row))
            }
          }
          return visible.toSorted(byNewestFirst)
        }),
        get: ({ providerId }) =>
          Effect.gen(function* () {
            const row = yield* findInWorkspace(providerId)
            return Option.fromNullishOr(row).pipe(Option.map(toDto))
          }),
        describe: ({ providerId }) =>
          Effect.gen(function* () {
            const row = yield* findInWorkspace(providerId)
            return Option.fromNullishOr(row).pipe(Option.map(toDetail))
          }),
        create: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const base: SeedSsoConnection = {
              id: yield* newCapabilityId('sso'),
              protocol: input.protocol,
              domain: input.domain,
              issuer: input.issuer,
              // New connections start disabled: an owner enables one after a
              // successful test, so a half-configured IdP never intercepts.
              enabled: false,
              requireSso: false,
              defaultWorkspaceRole: input.defaultWorkspaceRole,
              clientIdLastFour: lastFour(input),
              createdAt: DateTime.formatIso(yield* DateTime.now),
              workspaceId: ctx.workspace.id
            }
            let row: SeedSsoConnection
            if (input.protocol === 'oidc') {
              row = {
                ...base,
                // The same detail Live parses out of the stored config blobs,
                // so a seed-layer `describe` answers the test step identically.
                oidc: {
                  authorizationEndpoint: input.endpoints.authorizationEndpoint,
                  tokenEndpoint: input.endpoints.tokenEndpoint,
                  jwksEndpoint: input.endpoints.jwksEndpoint,
                  userInfoEndpoint: input.endpoints.userInfoEndpoint ?? null
                }
              }
            } else {
              row = {
                ...base,
                saml: {
                  metadataXml: input.metadataXml,
                  entryPoint: input.entryPoint
                }
              }
            }
            rows.push(row)
            yield* recordCreated(
              audit,
              ctx.workspace.id,
              ctx.actor?.userId ?? null,
              row
            )
            return toDto(row)
          }),
        update: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const row = yield* findInWorkspace(input.providerId)
            if (row === undefined) {
              return Option.none<SsoConnection>()
            }
            // The rule both adapters enforce: OIDC credentials only update an
            // OIDC connection. The live plugin rejects the same call with a 400.
            if (input.oidcCredentials !== undefined && row.protocol === 'saml') {
              return yield* Effect.fail(
                new MembershipChangeRejected({ reason: 'protocol_mismatch' })
              )
            }
            let clientIdLastFour = row.clientIdLastFour
            if (input.oidcCredentials !== undefined) {
              clientIdLastFour = input.oidcCredentials.clientId.slice(-4)
            }
            const updated: SeedSsoConnection = {
              ...row,
              enabled: input.enabled ?? row.enabled,
              requireSso: input.requireSso ?? row.requireSso,
              defaultWorkspaceRole:
                input.defaultWorkspaceRole ?? row.defaultWorkspaceRole,
              clientIdLastFour
            }
            rows[rows.indexOf(row)] = updated
            yield* recordUpdated(
              audit,
              ctx.workspace.id,
              ctx.actor?.userId ?? null,
              updated
            )
            return Option.some(toDto(updated))
          }),
        remove: ({ providerId }) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const index = rows.findIndex(
              (row) => row.id === providerId && row.workspaceId === ctx.workspace.id
            )
            if (index === -1) {
              return false
            }
            const [removed] = rows.splice(index, 1)
            if (removed === undefined) {
              return false
            }
            yield* recordRemoved(
              audit,
              ctx.workspace.id,
              ctx.actor?.userId ?? null,
              removed
            )
            return true
          }),
        resolveRouting: (email) =>
          Effect.sync(() => {
            const match = rows
              .filter((row) => row.enabled && matchesEmailDomain(email, row.domain))
              .toSorted(byProviderId)[0]
            if (match === undefined) {
              return Option.none<SsoRoutingDecision>()
            }
            return Option.some<SsoRoutingDecision>({
              providerId: match.id,
              protocol: match.protocol,
              workspaceId: match.workspaceId,
              requireSso: match.requireSso
            })
          }),
        resolveProvider: (providerId) =>
          Effect.sync(() => {
            const match = rows.find((row) => row.id === providerId)
            if (match === undefined) {
              return Option.none<{
                readonly workspaceId: string
                readonly domain: string
              }>()
            }
            return Option.some({
              workspaceId: match.workspaceId,
              domain: match.domain
            })
          })
      }
    })
  )
}

function lastFour(input: CreateSsoConnectionInput): string | null {
  if (input.protocol === 'oidc') {
    return input.clientId.slice(-4)
  }
  return null
}

/** Newest first, the list order the settings UI shows. */
function byNewestFirst(a: SsoConnection, b: SsoConnection): number {
  if (a.createdAt > b.createdAt) {
    return -1
  }
  if (a.createdAt < b.createdAt) {
    return 1
  }
  return 0
}

/** Deterministic pick order when several enabled connections match a domain. */
function byProviderId(a: SeedSsoConnection, b: SeedSsoConnection): number {
  if (a.id < b.id) {
    return -1
  }
  if (a.id > b.id) {
    return 1
  }
  return 0
}

function recordCreated(
  audit: AuditEventLogInterface,
  workspaceId: string,
  actorUserId: string | null,
  row: SeedSsoConnection
): Effect.Effect<void, CapabilityUnavailable> {
  return audit.record({
    workspaceId,
    actorUserId,
    eventType: 'workspace_sso.connection_created',
    targetType: 'workspace_sso_connection',
    targetId: row.id,
    metadata: {
      protocol: row.protocol,
      domain: row.domain,
      defaultWorkspaceRole: row.defaultWorkspaceRole
    }
  })
}

function recordUpdated(
  audit: AuditEventLogInterface,
  workspaceId: string,
  actorUserId: string | null,
  row: SeedSsoConnection
): Effect.Effect<void, CapabilityUnavailable> {
  return audit.record({
    workspaceId,
    actorUserId,
    eventType: 'workspace_sso.connection_updated',
    targetType: 'workspace_sso_connection',
    targetId: row.id,
    metadata: {
      enabled: row.enabled,
      requireSso: row.requireSso,
      defaultWorkspaceRole: row.defaultWorkspaceRole
    }
  })
}

function recordRemoved(
  audit: AuditEventLogInterface,
  workspaceId: string,
  actorUserId: string | null,
  row: SeedSsoConnection
): Effect.Effect<void, CapabilityUnavailable> {
  return audit.record({
    workspaceId,
    actorUserId,
    eventType: 'workspace_sso.connection_removed',
    targetType: 'workspace_sso_connection',
    targetId: row.id,
    metadata: { protocol: row.protocol, domain: row.domain }
  })
}

function toDto(row: SeedSsoConnection): SsoConnection {
  return {
    id: row.id,
    protocol: row.protocol,
    domain: row.domain,
    issuer: row.issuer,
    enabled: row.enabled,
    requireSso: row.requireSso,
    defaultWorkspaceRole: row.defaultWorkspaceRole,
    clientIdLastFour: row.clientIdLastFour,
    createdAt: row.createdAt
  }
}

function toDetail(row: SeedSsoConnection): SsoConnectionDetail {
  return {
    ...toDto(row),
    oidc: row.oidc ?? null,
    saml: row.saml ?? null
  }
}
