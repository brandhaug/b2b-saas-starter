import { Context, DateTime, Effect, Schema } from 'effect'

import { type CapabilityUnavailable, MembershipChangeRejected } from '../errors.ts'
export type { SsoPolicyOptions } from './sso-policy-config.ts'

export const SSO_DEFAULT_PROOF_TTL_MS = 12 * 60 * 60 * 1000
export const SSO_AUTH_RECENCY_MS = 5 * 60 * 1000
export const SSO_RECOVERY_TTL_MS = 60 * 60 * 1000
export const SSO_DOMAIN_GRACE_MS = 7 * 24 * 60 * 60 * 1000

export const SsoRecoveryPurpose = Schema.Literals(['workspace', 'sso_repair'])
export type SsoRecoveryPurpose = typeof SsoRecoveryPurpose.Type

export const SsoRecoveryNotificationAction = Schema.Literals([
  'created',
  'used',
  'expired'
])
export type SsoRecoveryNotificationAction = typeof SsoRecoveryNotificationAction.Type

export type SsoProof = {
  readonly id?: string
  readonly workspaceId: string
  readonly userId: string
  readonly sessionId: string
  readonly providerId: string
  readonly connectionGeneration: number
  readonly authenticatedAt: string
  readonly expiresAt: string
}

export type SsoProofCheck = {
  readonly now: string
  readonly connectionGeneration: number
  readonly workspaceId: string
  readonly userId: string
  readonly sessionId: string
  readonly providerId: string
}

export type SsoRecoveryException = {
  readonly id: string
  readonly workspaceId: string
  readonly userId: string
  readonly grantedBy: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly usedAt: string | null
  readonly expiredAt: string | null
  readonly sessionId: string | null
}

export type CreateSsoRecoveryExceptionInput = {
  readonly workspaceId: string
  readonly userId: string
  /** Human-readable ticket or verification note. Never authentication evidence. */
  readonly reason: string
  /** Operator identity from the trusted operator tool. */
  readonly grantedBy: string
}

export type UseSsoRecoveryExceptionInput = {
  readonly exceptionId: string
  readonly userId: string
  readonly sessionId: string
}

export type ActiveSsoRecoveryExceptionInput = {
  readonly workspaceId: string
  readonly userId: string
  readonly sessionId: string
}

/** Auth writes proof for a completed SSO callback before committing its session. */
export type SsoAuthenticationPort = {
  readonly recordAuthenticationProof: (input: {
    readonly workspaceId: string
    readonly userId: string
    readonly sessionId: string
    readonly providerId: string
    readonly connectionGeneration: number
    readonly authenticatedAt: string
  }) => Promise<SsoProof>
  readonly checkAuthenticationProof: (input: SsoProofCheck) => Promise<boolean>
  readonly bumpConnectionGeneration: (input: {
    readonly providerId: string
    readonly expectedGeneration: number
  }) => Promise<number>
}

export type SsoPolicyInterface = {
  readonly recordAuthenticationProof: (
    input: Parameters<SsoAuthenticationPort['recordAuthenticationProof']>[0]
  ) => Effect.Effect<SsoProof, CapabilityUnavailable>
  readonly checkAuthenticationProof: (
    input: SsoProofCheck
  ) => Effect.Effect<boolean, CapabilityUnavailable>
  readonly requireRecentAuthentication: (input: {
    readonly authenticatedAt: string
    readonly now: string
  }) => Effect.Effect<void, MembershipChangeRejected>
  /** Operator-only entrypoint. The implementation verifies current ownership. */
  readonly createRecoveryException: (
    input: CreateSsoRecoveryExceptionInput
  ) => Effect.Effect<
    SsoRecoveryException,
    CapabilityUnavailable | MembershipChangeRejected
  >
  /**
   * Activates one grant for the current session. The implementation reads
   * auth-owned evidence and never accepts a caller's claim about its method.
   */
  readonly useRecoveryException: (
    input: UseSsoRecoveryExceptionInput
  ) => Effect.Effect<
    SsoRecoveryException,
    CapabilityUnavailable | MembershipChangeRejected
  >
  /** Used only by an SSO-repair request context. General access ignores it. */
  readonly hasActiveRecoveryException: (
    input: ActiveSsoRecoveryExceptionInput
  ) => Effect.Effect<boolean, CapabilityUnavailable>
  /** Stamps and audits every newly expired grant. Safe to run repeatedly. */
  readonly expireRecoveryExceptions: Effect.Effect<number, CapabilityUnavailable>
  /** Delivers pending owner notifications and retries unfinished fan-out. */
  readonly flushRecoveryNotifications: Effect.Effect<number, CapabilityUnavailable>
}

export class SsoPolicy extends Context.Service<SsoPolicy, SsoPolicyInterface>()(
  '@b2b-saas-starter/capabilities/SsoPolicy'
) {}

export function normalizeSsoDomain(domain: string): string | undefined {
  const value = domain.trim().toLowerCase().replace(/\.$/, '')
  if (value.length > 253) {
    return undefined
  }
  const labels = value.split('.')
  if (labels.length < 2) {
    return undefined
  }
  const validLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
  if (labels.some((label) => !validLabel.test(label))) {
    return undefined
  }
  return value
}

/** A proof is authoritative only for this session, connection and generation. */
export function acceptsSsoProof(proof: SsoProof, check: SsoProofCheck): boolean {
  return (
    proof.workspaceId === check.workspaceId &&
    proof.userId === check.userId &&
    proof.sessionId === check.sessionId &&
    proof.providerId === check.providerId &&
    proof.connectionGeneration === check.connectionGeneration &&
    proof.authenticatedAt <= check.now &&
    proof.expiresAt > check.now
  )
}

export function hasRecentAuthentication(
  authenticatedAt: string,
  now: string,
  recencyMs = SSO_AUTH_RECENCY_MS
): boolean {
  const elapsed = Date.parse(now) - Date.parse(authenticatedAt)
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= recencyMs
}

export function requireRecentAuthentication(
  input: {
    readonly authenticatedAt: string
    readonly now: string
  },
  recencyMs = SSO_AUTH_RECENCY_MS
): Effect.Effect<void, MembershipChangeRejected> {
  if (hasRecentAuthentication(input.authenticatedAt, input.now, recencyMs)) {
    return Effect.void
  }
  return Effect.fail(
    new MembershipChangeRejected({ reason: 'recent_authentication_required' })
  )
}

export function proofExpiry(
  authenticatedAt: string,
  ttlMs = SSO_DEFAULT_PROOF_TTL_MS
): string {
  return DateTime.formatIso(
    DateTime.addDuration(DateTime.makeUnsafe(authenticatedAt), ttlMs)
  )
}

export function recoveryExpiry(createdAt: string): string {
  return DateTime.formatIso(
    DateTime.addDuration(DateTime.makeUnsafe(createdAt), SSO_RECOVERY_TTL_MS)
  )
}

export function domainGraceExpiry(lastCheckedAt: string): string {
  return DateTime.formatIso(
    DateTime.addDuration(DateTime.makeUnsafe(lastCheckedAt), SSO_DOMAIN_GRACE_MS)
  )
}

/** Machine credentials remain valid under ordinary token rules. */
export function requiresHumanSsoProof(
  actorType: 'user' | 'api_token' | 'system'
): boolean {
  return actorType !== 'api_token'
}
