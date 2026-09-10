import { session, twoFactor, passkey } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import {
  orUnavailable,
  type CapabilityUnavailable
} from '@b2b-saas-starter/failure/capability'
import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'

const STRONG_AUTH_MAX_AGE_MS = 12 * 60 * 60 * 1000
const RECENT_AUTH_MAX_AGE_MS = 5 * 60 * 1000
const PASSWORD_VERIFICATION_MAX_AGE_MS = 5 * 60 * 1000

export type StrongAuthenticationStatus = {
  readonly qualified: boolean
  readonly recent: boolean
  readonly recovering: boolean
  readonly hasFactors: boolean
  readonly passwordVerified: boolean
}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call
export class StrongAuthenticationRequired extends Schema.TaggedError<StrongAuthenticationRequired>()(
  'StrongAuthenticationRequired',
  {},
  { httpApiStatus: 403 }
) {}

export type StrongAuthenticationInput = {
  readonly userId: string
  readonly sessionId: string
}

export type StrongAuthenticationInterface = {
  readonly status: (
    input: StrongAuthenticationInput
  ) => Effect.Effect<StrongAuthenticationStatus, CapabilityUnavailable>
  readonly requireRecent: (
    input: StrongAuthenticationInput
  ) => Effect.Effect<void, CapabilityUnavailable | StrongAuthenticationRequired>
  readonly require: (
    input: StrongAuthenticationInput
  ) => Effect.Effect<void, CapabilityUnavailable | StrongAuthenticationRequired>
}

export class StrongAuthentication extends Context.Service<
  StrongAuthentication,
  StrongAuthenticationInterface
>()('@b2b-saas-starter/capabilities/StrongAuthentication') {}

type SessionEvidence = {
  readonly expiresAt: Date
  readonly impersonatedBy: string | null
  readonly passwordVerifiedAt: Date | null
  readonly strongAuthAt: Date | null
  readonly strongAuthMethod: string | null
  readonly strongAuthCredentialId: string | null
  readonly recoveryUntil: Date | null
}

function evaluate(
  evidence: SessionEvidence | null,
  totpId: string | null,
  passkeyIds: ReadonlyArray<string>,
  now: Date
): StrongAuthenticationStatus {
  const hasTotp = totpId !== null
  const hasPasskey = passkeyIds.length > 0
  const hasFactors = hasTotp || hasPasskey
  if (evidence === null || evidence.expiresAt.getTime() <= now.getTime()) {
    return {
      qualified: false,
      recent: false,
      recovering: false,
      hasFactors: false,
      passwordVerified: false
    }
  }
  if (evidence.impersonatedBy !== null) {
    return {
      qualified: false,
      recent: false,
      recovering: false,
      hasFactors,
      passwordVerified: false
    }
  }
  const passwordVerified =
    evidence.passwordVerifiedAt !== null &&
    evidence.passwordVerifiedAt.getTime() <= now.getTime() &&
    now.getTime() - evidence.passwordVerifiedAt.getTime() <=
      PASSWORD_VERIFICATION_MAX_AGE_MS
  const credentialIsCurrent =
    (evidence.strongAuthMethod === 'totp' &&
      totpId !== null &&
      evidence.strongAuthCredentialId === totpId) ||
    (evidence.strongAuthMethod === 'passkey' &&
      evidence.strongAuthCredentialId !== null &&
      passkeyIds.includes(evidence.strongAuthCredentialId))
  const strongAuthCurrent =
    evidence.strongAuthAt !== null &&
    evidence.strongAuthAt.getTime() <= now.getTime() &&
    now.getTime() - evidence.strongAuthAt.getTime() <= STRONG_AUTH_MAX_AGE_MS
  const recovering =
    evidence.recoveryUntil !== null && evidence.recoveryUntil.getTime() > now.getTime()
  return {
    qualified: !recovering && strongAuthCurrent && credentialIsCurrent,
    recent:
      !recovering &&
      ((strongAuthCurrent &&
        credentialIsCurrent &&
        now.getTime() - evidence.strongAuthAt.getTime() <= RECENT_AUTH_MAX_AGE_MS) ||
        (!hasFactors && evidence.strongAuthMethod === null && passwordVerified)),
    recovering,
    hasFactors,
    passwordVerified
  }
}

export const SeedStrongAuthentication: Layer.Layer<StrongAuthentication> =
  Layer.succeed(StrongAuthentication)({
    status: () =>
      Effect.succeed({
        qualified: false,
        recent: false,
        recovering: false,
        hasFactors: false,
        passwordVerified: false
      }),
    require: () => Effect.fail(new StrongAuthenticationRequired()),
    requireRecent: () => Effect.fail(new StrongAuthenticationRequired())
  })

export const LiveStrongAuthentication: Layer.Layer<
  StrongAuthentication,
  never,
  Database
> = Layer.effect(StrongAuthentication)(
  Effect.gen(function* () {
    const db = yield* Database
    const unavailable = orUnavailable('strong-authentication')
    const status = Effect.fn('StrongAuthentication.status')(function* (
      input: StrongAuthenticationInput
    ) {
      const [row] = yield* unavailable(
        db
          .select({
            expiresAt: session.expiresAt,
            impersonatedBy: session.impersonatedBy,
            passwordVerifiedAt: session.passwordVerifiedAt,
            strongAuthAt: session.strongAuthAt,
            strongAuthMethod: session.strongAuthMethod,
            strongAuthCredentialId: session.strongAuthCredentialId,
            recoveryUntil: session.recoveryUntil
          })
          .from(session)
          .where(and(eq(session.id, input.sessionId), eq(session.userId, input.userId)))
          .limit(1)
      )
      const [totp] = yield* unavailable(
        db
          .select({ id: twoFactor.id })
          .from(twoFactor)
          .where(and(eq(twoFactor.userId, input.userId), eq(twoFactor.verified, true)))
          .limit(1)
      )
      const keys = yield* unavailable(
        db
          .select({ id: passkey.id })
          .from(passkey)
          .where(eq(passkey.userId, input.userId))
      )
      const now = yield* DateTime.now
      let evidence: SessionEvidence | null = null
      if (row !== undefined) {
        evidence = {
          expiresAt: row.expiresAt,
          impersonatedBy: row.impersonatedBy,
          passwordVerifiedAt: row.passwordVerifiedAt,
          strongAuthAt: row.strongAuthAt,
          strongAuthMethod: row.strongAuthMethod,
          strongAuthCredentialId: row.strongAuthCredentialId,
          recoveryUntil: row.recoveryUntil
        }
      }
      return evaluate(
        evidence,
        totp?.id ?? null,
        keys.map((key) => key.id),
        DateTime.toDate(now)
      )
    })
    return {
      status,
      requireRecent: Effect.fn('StrongAuthentication.requireRecent')(function* (input) {
        const result = yield* status(input)
        if (!result.recent) {
          return yield* new StrongAuthenticationRequired()
        }
      }),
      require: (input) =>
        status(input).pipe(
          Effect.flatMap((result) => {
            if (result.qualified) {
              return Effect.void
            }
            return Effect.fail(new StrongAuthenticationRequired())
          })
        )
    }
  })
)
