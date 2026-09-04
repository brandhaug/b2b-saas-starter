import { DateTime, Effect, Layer, Option } from 'effect'

import { newCapabilityId } from '../internal/ids.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog, recordInWorkspace } from './audit-event-log.ts'
import {
  pickSignInTarget,
  requireProtocolMatch,
  SsoConnections,
  ssoAuditEvent,
  toRoutingDecision,
  type CreateSsoConnectionInput,
  type SsoConnection,
  type SsoConnectionDetail
} from './workspace-sso-connections.ts'

/**
 * Seed rows carry the workspace id so `resolveRouting` — which has no
 * `WorkspaceContext` to read one from — can still answer. It is stripped from
 * the DTO, same as `SeedNotification.userId`. The protocol detail is
 * discriminated on the row's own protocol, mirroring
 * `CreateSsoConnectionInput`: an OIDC row carries `oidc`, a SAML row carries
 * `saml`, and a wrong-protocol fixture is a type error rather than a
 * `describe` answer with a fabricated `null` segment.
 */
export type SeedSsoConnection = SsoConnection & {
  readonly workspaceId: string
} & (
    | {
        readonly protocol: 'oidc'
        readonly oidc: NonNullable<SsoConnectionDetail['oidc']>
      }
    | {
        readonly protocol: 'saml'
        readonly saml: NonNullable<SsoConnectionDetail['saml']>
      }
  )

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
            // New connections start disabled: an owner enables one after a
            // successful test, so a half-configured IdP never intercepts.
            const base: SsoConnection & { readonly workspaceId: string } = {
              id: yield* newCapabilityId('sso'),
              protocol: input.protocol,
              domain: input.domain,
              issuer: input.issuer,
              enabled: false,
              requireSso: false,
              defaultWorkspaceRole: input.defaultWorkspaceRole,
              clientIdLastFour: lastFour(input),
              createdAt: DateTime.formatIso(yield* DateTime.now),
              workspaceId: ctx.workspace.id
            }
            // The same detail Live parses out of the stored config blobs, so
            // a seed-layer `describe` answers the test step identically.
            let row: SeedSsoConnection
            if (input.protocol === 'oidc') {
              row = {
                ...base,
                protocol: 'oidc',
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
                protocol: 'saml',
                saml: {
                  metadataXml: input.metadataXml,
                  entryPoint: input.entryPoint
                }
              }
            }
            rows.push(row)
            const dto = toDto(row)
            yield* recordInWorkspace(audit, {
              ...ssoAuditEvent('created', dto),
              targetId: dto.id
            })
            return dto
          }),
        update: (input) =>
          Effect.gen(function* () {
            const row = yield* findInWorkspace(input.providerId)
            if (row === undefined) {
              return Option.none<SsoConnection>()
            }
            yield* requireProtocolMatch(row, input)
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
            const dto = toDto(updated)
            yield* recordInWorkspace(audit, {
              ...ssoAuditEvent('updated', dto),
              targetId: dto.id
            })
            return Option.some(dto)
          }),
        remove: ({ providerId }) =>
          Effect.gen(function* () {
            const row = yield* findInWorkspace(providerId)
            if (row === undefined) {
              return false
            }
            rows.splice(rows.indexOf(row), 1)
            yield* recordInWorkspace(audit, {
              ...ssoAuditEvent('removed', row),
              targetId: row.id
            })
            return true
          }),
        resolveRouting: (email) =>
          Effect.sync(() => {
            // Only enabled connections route — a disabled row persists for the
            // settings UI without intercepting sign-ins (the auth gate
            // enforces the same rule for direct `/sign-in/sso` calls).
            return Option.map(
              Option.fromNullishOr(
                pickSignInTarget(
                  rows.filter((row) => row.enabled),
                  { email }
                )
              ),
              toRoutingDecision
            )
          }),
        resolveSignInTarget: (input) =>
          Effect.sync(() =>
            // Unfiltered by `enabled`: the gate needs to see a disabled
            // resolution to refuse it.
            Option.fromNullishOr(pickSignInTarget(rows, input))
          ),
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
  if (row.protocol === 'oidc') {
    return { ...toDto(row), oidc: row.oidc, saml: null }
  }
  return { ...toDto(row), oidc: null, saml: row.saml }
}
