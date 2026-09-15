/* oxlint-disable effect/noAsyncFunction, effect/noGlobals -- Better Auth database callbacks run outside Effect and use native timestamps. */
import { assistantSessionAuthority } from '@b2b-saas-starter/db/schema'
import { type GenericEndpointContext } from 'better-auth'
import { and, eq, ne } from 'drizzle-orm'
import { Schema } from 'effect'
import { type DrizzleDatabase } from './ports.ts'

const isString = Schema.is(Schema.String)

/** Session reads discard expired rows; every other delete is explicit revocation. */
export function assistantSessionDeleteHook(db: DrizzleDatabase) {
  return async (
    session: { readonly id: string; readonly expiresAt: Date },
    ctx: GenericEndpointContext | null
  ) => {
    if (ctx?.path === '/get-session' && session.expiresAt.getTime() <= Date.now()) {
      return
    }
    await db
      .update(assistantSessionAuthority)
      .set({ revokedAt: new Date() })
      .where(eq(assistantSessionAuthority.sessionId, session.id))
  }
}

/** A revoke-all operation also revokes references whose live session expired already. */
export async function revokeRetainedAssistantSessions(
  db: DrizzleDatabase,
  ctx: GenericEndpointContext
): Promise<void> {
  let userId: string | undefined
  if (ctx.path === '/revoke-sessions' || ctx.path === '/revoke-other-sessions') {
    userId = ctx.context.session?.user.id
  } else if (ctx.path === '/admin/revoke-user-sessions' && isString(ctx.body?.userId)) {
    userId = ctx.body.userId
  }
  if (userId === undefined) {
    return
  }
  const conditions = [eq(assistantSessionAuthority.userId, userId)]
  const currentId = ctx.context.session?.session.id
  if (ctx.path === '/revoke-other-sessions' && currentId) {
    conditions.push(ne(assistantSessionAuthority.sessionId, currentId))
  }
  await db
    .update(assistantSessionAuthority)
    .set({ revokedAt: new Date() })
    .where(and(...conditions))
}
