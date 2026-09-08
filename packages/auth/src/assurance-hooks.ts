/* oxlint-disable effect/noAsyncFunction, effect/noGlobals, effect/noThrowStatement, effect/noTryCatch -- Better Auth invokes these database and endpoint callbacks outside Effect; its APIError and native Date are the adapter contract. */
import * as schema from '@b2b-saas-starter/db/schema'
import { type GenericEndpointContext } from 'better-auth'
import {
  APIError,
  createAuthMiddleware,
  isAPIError,
  getSessionFromCtx
} from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import { passwordTOTPCanPair, recoveryExpiresAt } from './assurance.ts'
import { isLocale } from '@b2b-saas-starter/i18n/locale'
import { Schema } from 'effect'
import { type AuthConfigInterface } from './ports.ts'

const isString = Schema.is(Schema.String)

const emptyProof = {
  passwordVerifiedAt: null,
  strongAuthAt: null,
  strongAuthMethod: null,
  strongAuthCredentialId: null,
  recoveryUntil: null
}
const emptyStrongProof = {
  strongAuthAt: null,
  strongAuthMethod: null,
  strongAuthCredentialId: null
}

/** Better Auth dispatch creates a fresh context for every API call, including
 * server calls without a Request. Never key ceremony evidence by user or cookie.
 * The verified callback and database hook share that call's context. */
export function makeAssuranceHooks(options: AuthConfigInterface) {
  const verifiedPasskeys = new WeakMap<GenericEndpointContext['context'], string>()
  const recoveryEnrollments = new WeakMap<GenericEndpointContext['context'], string>()
  const db = options.db

  async function invalidatePassword(userId: string) {
    await db
      .update(schema.session)
      .set({ passwordVerifiedAt: null, ...emptyStrongProof })
      .where(
        and(
          eq(schema.session.userId, userId),
          eq(schema.session.strongAuthMethod, 'totp')
        )
      )
    await db
      .update(schema.session)
      .set({ passwordVerifiedAt: null })
      .where(eq(schema.session.userId, userId))
  }

  return {
    markVerifiedPasskey(
      context: GenericEndpointContext['context'],
      credentialId: string
    ) {
      verifiedPasskeys.set(context, credentialId)
    },
    invalidatePassword,
    sessionCreateBefore: async (
      session: { readonly userId: string },
      ctx: GenericEndpointContext | null
    ) => {
      const credentialID = ctx && verifiedPasskeys.get(ctx.context)
      if (ctx) {
        verifiedPasskeys.delete(ctx.context)
      }
      if (credentialID) {
        const [factor] = await db
          .select()
          .from(schema.passkey)
          .where(
            and(
              eq(schema.passkey.credentialID, credentialID),
              eq(schema.passkey.userId, session.userId)
            )
          )
        if (factor) {
          return {
            data: {
              ...session,
              ...emptyProof,
              strongAuthAt: new Date(),
              strongAuthMethod: 'passkey',
              strongAuthCredentialId: factor.id
            }
          }
        }
      }
      if (ctx?.path === '/sign-in/email' || ctx?.path === '/sign-in/username') {
        return { data: { ...session, ...emptyProof, passwordVerifiedAt: new Date() } }
      }
      // Plugin rotations pass the old session as an override. Strip all proof
      // first, then retain only permitted evidence from the authoritative row.
      if (
        ctx?.path === '/two-factor/verify-totp' ||
        ctx?.path === '/two-factor/disable' ||
        ctx?.path === '/passkey/verify-registration'
      ) {
        const previousId = ctx.context.session?.session.id
        if (!previousId) {
          return { data: { ...session, ...emptyProof } }
        }
        const [previous] = await db
          .select()
          .from(schema.session)
          .where(eq(schema.session.id, previousId))
        if (!previous || previous.expiresAt.getTime() <= Date.now()) {
          throw new APIError('UNAUTHORIZED', {
            message: 'The originating session is no longer active.'
          })
        }
        let passwordVerifiedAt: Date | null = null
        if (
          ctx.path !== '/passkey/verify-registration' &&
          passwordTOTPCanPair(previous)
        ) {
          passwordVerifiedAt = previous.passwordVerifiedAt
        }
        const data = {
          ...session,
          ...emptyProof,
          passwordVerifiedAt,
          recoveryUntil: previous.recoveryUntil
        }
        if (previous.recoveryUntil) {
          return { data: { ...data, expiresAt: previous.recoveryUntil } }
        }
        return { data }
      }
      return { data: { ...session, ...emptyProof } }
    },
    sessionUpdateBefore: async (
      data: { readonly expiresAt?: Date },
      ctx: GenericEndpointContext | null
    ) => {
      const id = ctx?.context.session?.session.id
      if (!id || !data.expiresAt) {
        return { data }
      }
      const [session] = await db
        .select()
        .from(schema.session)
        .where(eq(schema.session.id, id))
      const deadline = session?.recoveryUntil
      if (!deadline) {
        return { data }
      }
      return {
        data: {
          ...data,
          expiresAt: new Date(
            Math.min(
              data.expiresAt.getTime(),
              deadline.getTime(),
              session.expiresAt.getTime()
            )
          )
        }
      }
    },
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/two-factor/verify-backup-code' && !options.recoveryHooks) {
        throw new APIError('FORBIDDEN', {
          message: 'Account recovery is not configured.'
        })
      }
      if (ctx.path === '/two-factor/verify-totp') {
        const current = await getSessionFromCtx(ctx)
        if (!current) {
          return
        }
        const [session] = await db
          .select()
          .from(schema.session)
          .where(eq(schema.session.id, current.session.id))
        if (!session?.recoveryUntil || !passwordTOTPCanPair(session)) {
          return
        }
        const [factor] = await db
          .select()
          .from(schema.twoFactor)
          .where(eq(schema.twoFactor.userId, current.user.id))
        if (factor?.verified === false) {
          recoveryEnrollments.set(ctx.context, factor.id)
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      const recoveringEnrollment = recoveryEnrollments.get(ctx.context)
      recoveryEnrollments.delete(ctx.context)
      const result = ctx.context.returned
      if (!result || isAPIError(result)) {
        return
      }
      const current = ctx.context.session
      const target = ctx.context.newSession ?? current
      if (!target) {
        return
      }
      const userId = target.user.id
      const sessionId = target.session.id
      const [session] = await db
        .select()
        .from(schema.session)
        .where(eq(schema.session.id, sessionId))
      if (!session) {
        return
      }
      const now = new Date()
      switch (ctx.path) {
        case '/verify-password': {
          await db
            .update(schema.session)
            .set({ passwordVerifiedAt: now })
            .where(eq(schema.session.id, sessionId))
          break
        }
        case '/two-factor/enable': {
          // Better Auth retains verified=true when replacing a secret in-place.
          // Recovery must verify the replacement before it can restore access.
          if (session.recoveryUntil) {
            await db
              .update(schema.twoFactor)
              .set({ verified: false })
              .where(eq(schema.twoFactor.userId, userId))
          }
          // Re-enabling replaces the secret in the same factor row.
          await db
            .update(schema.session)
            .set(emptyStrongProof)
            .where(
              and(
                eq(schema.session.userId, userId),
                eq(schema.session.strongAuthMethod, 'totp')
              )
            )
          await db
            .update(schema.session)
            .set({ passwordVerifiedAt: now })
            .where(eq(schema.session.id, sessionId))
          break
        }
        case '/two-factor/disable': {
          await db
            .update(schema.session)
            .set(emptyStrongProof)
            .where(
              and(
                eq(schema.session.userId, userId),
                eq(schema.session.strongAuthMethod, 'totp')
              )
            )
          break
        }
        case '/two-factor/verify-totp': {
          if (session.recoveryUntil && !recoveringEnrollment) {
            break
          }
          if (current && !passwordTOTPCanPair(session, now)) {
            break
          }
          const [factor] = await db
            .select()
            .from(schema.twoFactor)
            .where(eq(schema.twoFactor.userId, userId))
          if (
            !factor?.verified ||
            (recoveringEnrollment && factor.id !== recoveringEnrollment)
          ) {
            break
          }
          await db
            .update(schema.session)
            .set({
              passwordVerifiedAt: session.passwordVerifiedAt ?? now,
              strongAuthAt: now,
              strongAuthMethod: 'totp',
              strongAuthCredentialId: factor.id,
              recoveryUntil: null
            })
            .where(eq(schema.session.id, sessionId))
          break
        }
        case '/two-factor/verify-backup-code': {
          const expiresAt = session.recoveryUntil ?? recoveryExpiresAt(now)
          await db
            .update(schema.session)
            // A known existing cookie must not repair factors while the audit
            // and notification are pending. Refresh cannot extend this expiry.
            .set({ ...emptyStrongProof, expiresAt: now, recoveryUntil: expiresAt })
            .where(eq(schema.session.id, sessionId))
          let locale = null
          if (isLocale(target.user.locale)) {
            locale = target.user.locale
          }
          try {
            await options.recoveryHooks?.onRecoveryStarted({
              userId,
              sessionId,
              expiresAt,
              email: target.user.email,
              locale
            })
          } catch (error) {
            await db.delete(schema.session).where(eq(schema.session.id, sessionId))
            throw error
          }
          const restored = await db
            .update(schema.session)
            .set({ expiresAt })
            .where(eq(schema.session.id, sessionId))
            .returning({ id: schema.session.id })
          if (restored.length === 0) {
            throw new APIError('UNAUTHORIZED', {
              message: 'The recovery session is no longer active.'
            })
          }
          break
        }
        case '/passkey/delete-passkey': {
          if (isString(ctx.body?.id)) {
            await db
              .update(schema.session)
              .set(emptyStrongProof)
              .where(
                and(
                  eq(schema.session.userId, userId),
                  eq(schema.session.strongAuthCredentialId, ctx.body.id)
                )
              )
          }
          break
        }
      }
    })
  }
}
