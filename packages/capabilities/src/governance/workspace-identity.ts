import {
  user,
  workspaceMembers,
  workspaceRoles
} from '@b2b-saas-starter/db/src/schema.ts'
import { type EffectDatabase } from '@b2b-saas-starter/db/src/service.ts'
import { Effect, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'

import { type CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'

/**
 * Workspace identity vocabulary: the role literals, the `Workspace` and
 * `Member` records, and the single-member lookup used to resolve an actor.
 *
 * This module exists to keep `workspace-context.ts` (which resolves the actor)
 * and `workspace-membership.ts` (which serves member reads and therefore
 * depends on `WorkspaceContext`) from importing each other. It owns types and
 * one query helper only — no service, no layer.
 */

export const WORKSPACE_ROLES = workspaceRoles
// oxlint-disable-next-line effect/noAs -- `as const` on a literal tuple, not a type assertion: Schema.Literals needs the narrowed readonly tuple to derive the SystemRole union.
export const SYSTEM_ROLES = ['admin', 'user'] as const

export const WorkspaceRole = Schema.Literals(WORKSPACE_ROLES)
export type WorkspaceRole = typeof WorkspaceRole.Type

export const SystemRole = Schema.Literals(SYSTEM_ROLES)
export type SystemRole = typeof SystemRole.Type

/**
 * The resolved viewer shape loaders hand to permission checks and UI: only
 * the workspace role, or nothing when no viewer is signed in.
 */
export type WorkspaceViewer = { readonly role: WorkspaceRole }

export const Workspace = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  planId: Schema.String
})
export type Workspace = typeof Workspace.Type

export const Member = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: WorkspaceRole,
  systemRole: SystemRole
})
export type Member = typeof Member.Type

/**
 * Fabricates the identity fields the seed fixtures have no `user` table to
 * join, the way `SeedApiTokenRegistry.create` fabricates a token. The email is
 * derived unless one is known — an accepted invitation carries its real
 * address.
 */
export function fabricateSeedMember(
  userId: string,
  role: WorkspaceRole,
  email?: string
): Member {
  return {
    id: userId,
    name: userId,
    email: email ?? `${userId}@seed.local`,
    role,
    systemRole: 'user'
  }
}

type MemberRow = {
  readonly member: typeof workspaceMembers.$inferSelect
  readonly user: typeof user.$inferSelect
}

/** Only the stored `admin` role grants the admin system role; everything else is a user. */
function toSystemRole(role: string | null): SystemRole {
  if (role === 'admin') return 'admin'
  return 'user'
}

export function toMember(row: MemberRow): Member {
  return {
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
    role: row.member.role,
    systemRole: toSystemRole(row.user.role)
  }
}

/**
 * Looks up a single member of a workspace by user id. Used by the
 * `WorkspaceContext` live layer to resolve (and enforce) the actor's
 * membership before any capability runs — this is a query helper, not an
 * authorization decision; the non-member failure policy lives in
 * `workspace-context.ts`.
 */
export function findWorkspaceMember(
  db: EffectDatabase,
  input: { readonly workspaceId: string; readonly userId: string }
): Effect.Effect<Member | undefined, CapabilityUnavailable> {
  return orUnavailable('workspace-membership')(
    db
      .select({ member: workspaceMembers, user })
      .from(workspaceMembers)
      .innerJoin(user, eq(user.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.userId)
        )
      )
      .limit(1)
  ).pipe(Effect.map((rows) => rows.map(toMember)[0]))
}
