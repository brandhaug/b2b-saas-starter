import {
  type AuthSsoHooks,
  type AuthSsoSession,
  type AuthSsoSessionHookContext,
  type DrizzleDatabase
} from '@b2b-saas-starter/auth'
import {
  account,
  passkey,
  session,
  ssoRecoveryAuthEvidence,
  twoFactor,
  user,
  verification,
  workspaceInvitations,
  workspaceMembers,
  workspaceSsoAuthProofs,
  workspaceSsoConnections,
  workspaceSsoDomainClaims,
  workspaceSsoRecoveryExceptions
} from '@b2b-saas-starter/db/schema'
import { APIError, getOAuthState } from 'better-auth/api'
import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm'
import { Option, Schema } from 'effect'

const PROOF_TTL = 12 * 60 * 60 * 1000
const CONFIG_AUTH_TTL = 5 * 60 * 1000
const FLOW_TTL = 10 * 60 * 1000
const TEST_PREFIX = 'starter-sso-test:'

const Flow = Schema.Struct({
  version: Schema.Literal(1),
  flowId: Schema.String,
  providerId: Schema.String,
  workspaceId: Schema.String,
  generation: Schema.Number,
  mode: Schema.Literals(['sign-in', 'test']),
  ownerUserId: Schema.optional(Schema.String),
  ownerSessionId: Schema.optional(Schema.String),
  expiresAt: Schema.String
})
type Flow = typeof Flow.Type

const OAuthState = Schema.Struct({
  serverContext: Schema.optional(
    Schema.Struct({ starterSsoFlow: Schema.optional(Flow) })
  )
})
const decodeOAuthState = Schema.decodeUnknownOption(OAuthState)
const decodeStoredFlow = Schema.decodeUnknownOption(Schema.fromJsonString(Flow))

function domainOf(email: string): string | undefined {
  const at = email.lastIndexOf('@')
  return at > 0 && at < email.length - 1
    ? email
        .slice(at + 1)
        .trim()
        .toLowerCase()
        .replace(/\.$/, '')
    : undefined
}

function stateFlow(parsed: ReturnType<typeof decodeOAuthState>): Flow | undefined {
  return Option.isSome(parsed) ? parsed.value.serverContext?.starterSsoFlow : undefined
}

function intentKey(flowId: string) {
  return `${TEST_PREFIX}${flowId}`
}

function parseIntent(value: string): Flow | undefined {
  const parsed = decodeStoredFlow(value)
  if (Option.isNone(parsed)) {
    return
  }
  const flow = parsed.value
  return flow.mode === 'test' &&
    flow.ownerUserId !== undefined &&
    flow.ownerSessionId !== undefined
    ? flow
    : undefined
}

function claimIsActive(
  claim: {
    readonly status: string
    readonly graceUntil: string | null
    readonly lastCheckedAt: string | null
  },
  now: Date
) {
  const checked =
    claim.lastCheckedAt === null ? Number.NaN : Date.parse(claim.lastCheckedAt)
  return (
    Number.isFinite(checked) &&
    now.getTime() - checked <= 7 * 24 * 60 * 60 * 1000 &&
    (claim.status === 'verified' ||
      (claim.status === 'grace' &&
        claim.graceUntil !== null &&
        Date.parse(claim.graceUntil) > now.getTime()))
  )
}

async function activeClaim(
  db: DrizzleDatabase,
  workspaceId: string,
  domain: string,
  now: Date
) {
  const [claim] = await db
    .select({
      status: workspaceSsoDomainClaims.status,
      graceUntil: workspaceSsoDomainClaims.graceUntil,
      lastCheckedAt: workspaceSsoDomainClaims.lastCheckedAt
    })
    .from(workspaceSsoDomainClaims)
    .where(
      and(
        eq(workspaceSsoDomainClaims.workspaceId, workspaceId),
        eq(workspaceSsoDomainClaims.domain, domain)
      )
    )
    .limit(1)
  return claim !== undefined && claimIsActive(claim, now)
}

async function currentSession(
  db: DrizzleDatabase,
  candidate: AuthSsoSession | null | undefined,
  now: Date
) {
  if (candidate === null || candidate === undefined) {
    return
  }
  const [row] = await db
    .select()
    .from(session)
    .where(
      and(
        eq(session.id, candidate.session.id),
        eq(session.userId, candidate.user.id),
        gt(session.expiresAt, now),
        isNull(session.impersonatedBy)
      )
    )
    .limit(1)
  return row
}

async function owner(db: DrizzleDatabase, workspaceId: string, userId: string) {
  const [row] = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.role, 'owner')
      )
    )
    .limit(1)
  return row !== undefined
}

async function configurationAuth(
  db: DrizzleDatabase,
  candidate: AuthSsoSession | null | undefined,
  workspaceId: string,
  now: Date,
  maxAgeMs: number
) {
  const current = await currentSession(db, candidate, now)
  if (current === undefined) {
    return
  }
  const [recovery] = await db
    .select({ id: workspaceSsoRecoveryExceptions.id })
    .from(workspaceSsoRecoveryExceptions)
    .where(
      and(
        eq(workspaceSsoRecoveryExceptions.workspaceId, workspaceId),
        eq(workspaceSsoRecoveryExceptions.userId, current.userId),
        eq(workspaceSsoRecoveryExceptions.sessionId, current.id),
        gt(workspaceSsoRecoveryExceptions.expiresAt, now.toISOString()),
        isNull(workspaceSsoRecoveryExceptions.expiredAt),
        isNotNull(workspaceSsoRecoveryExceptions.usedAt)
      )
    )
    .limit(1)
  if (recovery !== undefined) {
    return current
  }

  const [required] = await db
    .select({
      providerId: workspaceSsoConnections.providerId,
      generation: workspaceSsoConnections.connectionGeneration
    })
    .from(workspaceSsoConnections)
    .where(
      and(
        eq(workspaceSsoConnections.workspaceId, workspaceId),
        eq(workspaceSsoConnections.requireSso, true)
      )
    )
    .limit(1)
  if (required !== undefined) {
    const [proof] = await db
      .select({ id: workspaceSsoAuthProofs.id })
      .from(workspaceSsoAuthProofs)
      .where(
        and(
          eq(workspaceSsoAuthProofs.workspaceId, workspaceId),
          eq(workspaceSsoAuthProofs.userId, current.userId),
          eq(workspaceSsoAuthProofs.sessionId, current.id),
          eq(workspaceSsoAuthProofs.providerId, required.providerId),
          eq(workspaceSsoAuthProofs.connectionGeneration, required.generation),
          gt(workspaceSsoAuthProofs.expiresAt, now.toISOString())
        )
      )
      .limit(1)
    if (proof === undefined) {
      return
    }
  }

  const age = now.getTime() - current.createdAt.getTime()
  return age >= 0 && age <= maxAgeMs ? current : undefined
}

async function storedFlow(db: DrizzleDatabase, flowId: string, now: Date) {
  const [row] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(
      and(
        eq(verification.identifier, intentKey(flowId)),
        gt(verification.expiresAt, now)
      )
    )
    .limit(1)
  const intent = row === undefined ? undefined : parseIntent(row.value)
  return intent !== undefined && Date.parse(intent.expiresAt) > now.getTime()
    ? intent
    : undefined
}

async function callbackProvider(
  envelope: AuthSsoSessionHookContext
): Promise<string | undefined> {
  const flow = stateFlow(decodeOAuthState(await getOAuthState()))
  if (flow !== undefined) {
    return flow.providerId
  }
  const path = envelope.context.path ?? ''
  return (
    path.match(/^\/sso\/callback\/([^/]+)$/)?.[1] ??
    path.match(/^\/sso\/saml2\/sp\/acs\/([^/]+)$/)?.[1]
  )
}

/* oxlint-disable effect/noThrowStatement -- Better Auth guard callbacks reject HTTP requests with the library's APIError. */
export function makeSsoAuthHooks(
  db: DrizzleDatabase,
  options: {
    readonly proofTtlMs?: number | undefined
    readonly configurationAuthRecencyMs?: number | undefined
  } = {}
): AuthSsoHooks {
  const proofTtlMs = options.proofTtlMs ?? PROOF_TTL
  const configurationAuthRecencyMs =
    options.configurationAuthRecencyMs ?? CONFIG_AUTH_TTL
  return {
    guardSignIn: async (raw) => {
      const value = raw
      const body = value.body ?? {}
      const providerId = body.providerId
      const email = body.email?.toLowerCase()
      let domain = body.domain?.toLowerCase()
      if (domain === undefined && email !== undefined) {
        domain = domainOf(email)
      }
      let candidates
      if (providerId === undefined) {
        if (domain === undefined) {
          throw new APIError('BAD_REQUEST', {
            message: 'SSO provider selector required'
          })
        }
        candidates = await db
          .select()
          .from(workspaceSsoConnections)
          .where(eq(workspaceSsoConnections.domain, domain))
          .limit(2)
      } else {
        candidates = await db
          .select()
          .from(workspaceSsoConnections)
          .where(eq(workspaceSsoConnections.providerId, providerId))
          .limit(1)
      }
      const connection = candidates[0]
      if (
        connection === undefined ||
        candidates.length > 1 ||
        !connection.domainVerified
      ) {
        throw new APIError('NOT_FOUND', { message: 'SSO provider selector is invalid' })
      }
      const now = new Date()
      const base = {
        version: 1,
        flowId: crypto.randomUUID(),
        providerId: connection.providerId,
        workspaceId: connection.workspaceId,
        generation: connection.connectionGeneration,
        expiresAt: new Date(now.getTime() + FLOW_TTL).toISOString()
      } satisfies Omit<Flow, 'mode' | 'ownerUserId' | 'ownerSessionId'>
      if (connection.enabled) {
        if (!(await activeClaim(db, connection.workspaceId, connection.domain, now))) {
          throw new APIError('FORBIDDEN', {
            message: 'SSO domain verification is stale'
          })
        }
        const flow = { ...base, mode: 'sign-in' } satisfies Flow
        await db.insert(verification).values({
          id: `verification_${crypto.randomUUID()}`,
          identifier: intentKey(flow.flowId),
          value: JSON.stringify(flow),
          expiresAt: new Date(flow.expiresAt),
          createdAt: now,
          updatedAt: now
        })
        return flow
      }
      if (providerId === undefined) {
        throw new APIError('FORBIDDEN', { message: 'SSO connection is disabled' })
      }
      const current = await configurationAuth(
        db,
        value.context?.session,
        connection.workspaceId,
        now,
        configurationAuthRecencyMs
      )
      if (
        current === undefined ||
        !(await owner(db, connection.workspaceId, current.userId))
      ) {
        throw new APIError('FORBIDDEN', {
          message: 'SSO connection tests require a recently authenticated owner'
        })
      }
      const intent: Flow = {
        ...base,
        mode: 'test',
        ownerUserId: current.userId,
        ownerSessionId: current.id
      }
      await db.insert(verification).values({
        id: `verification_${crypto.randomUUID()}`,
        identifier: intentKey(intent.flowId),
        value: JSON.stringify(intent),
        expiresAt: new Date(intent.expiresAt),
        createdAt: now,
        updatedAt: now
      })
      return intent
    },

    guardProviderOwner: async (raw) => {
      const value = raw
      const now = new Date()
      const body = value.body ?? {}
      const providerId = body.providerId
      const organizationId = body.organizationId
      const [provider] =
        providerId === undefined
          ? []
          : await db
              .select({ workspaceId: workspaceSsoConnections.workspaceId })
              .from(workspaceSsoConnections)
              .where(eq(workspaceSsoConnections.providerId, providerId))
              .limit(1)
      const workspaceId = provider?.workspaceId ?? organizationId
      const current =
        workspaceId === undefined
          ? undefined
          : await configurationAuth(
              db,
              value.context?.session,
              workspaceId,
              now,
              configurationAuthRecencyMs
            )
      if (
        workspaceId === undefined ||
        current === undefined ||
        !(await owner(db, workspaceId, current.userId))
      ) {
        throw new APIError('FORBIDDEN', {
          message: 'SSO provider mutations require a recently authenticated owner'
        })
      }
    },

    guardProviderMutation: async (input) => {
      if (input.providerReference.providerId !== input.provider.providerId) {
        throw new APIError('CONFLICT', { message: 'SSO provider reference changed' })
      }
      const [connection] = await db
        .select({
          enabled: workspaceSsoConnections.enabled,
          requireSso: workspaceSsoConnections.requireSso
        })
        .from(workspaceSsoConnections)
        .where(eq(workspaceSsoConnections.providerId, input.provider.providerId))
        .limit(1)
      const boundary = input.action === 'update' && input.isAuthenticationBoundaryChange
      if (
        (connection?.enabled === true || connection?.requireSso === true) &&
        (input.action === 'delete' || boundary)
      ) {
        throw new APIError('CONFLICT', {
          message: 'active SSO policy must be retired before mutation'
        })
      }
    },

    beforeSessionCreate: async (row, raw) => {
      const envelope = raw
      const providerId = await callbackProvider(envelope)
      if (providerId === undefined) {
        return
      }
      const { id: sessionId, userId } = row
      const [connection] = await db
        .select()
        .from(workspaceSsoConnections)
        .where(eq(workspaceSsoConnections.providerId, providerId))
        .limit(1)
      if (connection === undefined) {
        return false
      }
      const now = new Date()
      const stateBoundFlow = stateFlow(decodeOAuthState(await getOAuthState()))
      const flow =
        stateBoundFlow ??
        (envelope.flowId === null
          ? undefined
          : await storedFlow(db, envelope.flowId, now))
      if (
        flow === undefined ||
        flow.providerId !== providerId ||
        flow.workspaceId !== connection.workspaceId ||
        flow.generation !== connection.connectionGeneration ||
        Date.parse(flow.expiresAt) <= now.getTime()
      ) {
        return false
      }
      if (!connection.enabled) {
        const existing = await currentSession(db, envelope.existingSession, now)
        if (
          flow.mode !== 'test' ||
          existing === undefined ||
          flow.ownerUserId !== userId ||
          flow.ownerSessionId !== existing.id ||
          !(await owner(db, connection.workspaceId, userId))
        ) {
          return false
        }
        await db
          .delete(verification)
          .where(eq(verification.identifier, intentKey(flow.flowId)))
        const updated = await db
          .update(workspaceSsoConnections)
          .set({ lastLoginTestedAt: now, lastLoginTestedBy: userId })
          .where(
            and(
              eq(workspaceSsoConnections.providerId, providerId),
              eq(workspaceSsoConnections.connectionGeneration, flow.generation),
              eq(workspaceSsoConnections.enabled, false)
            )
          )
          .returning({ id: workspaceSsoConnections.id })
        return updated.length === 1 ? undefined : false
      }
      if (
        !connection.domainVerified ||
        !(await activeClaim(db, connection.workspaceId, connection.domain, now))
      ) {
        return false
      }
      if (flow.mode !== 'sign-in') {
        return false
      }
      const [identity] = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)
      if (identity === undefined) {
        return false
      }
      const email = identity.email.trim().toLowerCase()
      const [membership] = await db
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, connection.workspaceId),
            eq(workspaceMembers.userId, userId)
          )
        )
        .limit(1)
      const [invitation] = await db
        .select({ id: workspaceInvitations.id })
        .from(workspaceInvitations)
        .where(
          and(
            eq(workspaceInvitations.workspaceId, connection.workspaceId),
            eq(workspaceInvitations.email, email),
            eq(workspaceInvitations.status, 'pending'),
            gt(workspaceInvitations.expiresAt, now)
          )
        )
        .limit(1)
      const verifiedDomainIdentity = domainOf(email) === connection.domain
      if (
        membership === undefined &&
        (!verifiedDomainIdentity || (invitation === undefined && !connection.autoJoin))
      ) {
        return false
      }
      await db
        .delete(verification)
        .where(eq(verification.identifier, intentKey(flow.flowId)))
      const authenticatedAt = now.toISOString()
      const expiresAt = new Date(now.getTime() + proofTtlMs).toISOString()
      await db
        .insert(workspaceSsoAuthProofs)
        .values({
          id: `sso_proof_${crypto.randomUUID()}`,
          workspaceId: connection.workspaceId,
          userId,
          sessionId,
          providerId,
          connectionGeneration: connection.connectionGeneration,
          authenticatedAt,
          expiresAt,
          createdAt: authenticatedAt
        })
        .onConflictDoUpdate({
          target: [
            workspaceSsoAuthProofs.sessionId,
            workspaceSsoAuthProofs.workspaceId
          ],
          set: {
            providerId,
            connectionGeneration: connection.connectionGeneration,
            authenticatedAt,
            expiresAt
          }
        })
    },

    afterSessionCreate: async (row, raw) => {
      const envelope = raw
      if (envelope.existingSession !== null) {
        return
      }
      const { id: sessionId, userId } = row
      const path = envelope.context.path
      const authenticatedAt = new Date().toISOString()
      if (path === '/passkey/verify-authentication') {
        const credentialId = envelope.context.body?.response?.id
        if (credentialId === undefined) {
          return
        }
        const [factor] = await db
          .select({ id: passkey.id })
          .from(passkey)
          .where(
            and(eq(passkey.credentialID, credentialId), eq(passkey.userId, userId))
          )
          .limit(1)
        if (factor === undefined) {
          return
        }
        await db
          .insert(ssoRecoveryAuthEvidence)
          .values({
            sessionId,
            userId,
            method: 'passkey',
            passkeyId: factor.id,
            authenticatedAt
          })
          .onConflictDoNothing()
        return
      }
      if (path !== '/two-factor/verify-totp') {
        return
      }
      const passwords = await db
        .select({ id: account.id })
        .from(account)
        .where(
          and(
            eq(account.userId, userId),
            eq(account.providerId, 'credential'),
            isNotNull(account.password)
          )
        )
        .limit(2)
      const factors = await db
        .select({ id: twoFactor.id })
        .from(twoFactor)
        .where(and(eq(twoFactor.userId, userId), eq(twoFactor.verified, true)))
        .limit(2)
      if (
        passwords.length !== 1 ||
        factors.length !== 1 ||
        passwords[0] === undefined ||
        factors[0] === undefined
      ) {
        return
      }
      await db
        .insert(ssoRecoveryAuthEvidence)
        .values({
          sessionId,
          userId,
          method: 'password_mfa',
          passwordAccountId: passwords[0].id,
          twoFactorId: factors[0].id,
          authenticatedAt
        })
        .onConflictDoNothing()
    }
  }
}
/* oxlint-enable effect/noThrowStatement */
