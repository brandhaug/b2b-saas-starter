/**
 * The owner of the `api_tokens` lifecycle predicates (ADR 0077): the named
 * live/rotated/revoked/expired decisions over the rotation columns, kept
 * drizzle-free like `enums.ts` so both `packages/billing` and
 * `packages/capabilities` consume one vocabulary. A token row is a live
 * leaf while it is neither revoked (`revoked_at`), rotated
 * (`replaced_by_token_id` points at its replacement) nor expired
 * (`expires_at` in the past); rotation chains resolve to exactly one leaf.
 *
 * SQL mirrors that must stay in step, named rather than edited:
 * - `api_tokens_retention_idx` orders retention by `CASE WHEN revoked_at IS
 *   NULL THEN expires_at WHEN expires_at IS NULL THEN revoked_at ELSE
 *   min(revoked_at, expires_at) END` (migration
 *   `20260907195706_organic_mercury`).
 * - `activeLeafTokenWhere` / `eligibleTokenWhere` in
 *   `packages/billing/src/resource-admission.ts` admit and count leaves in
 *   SQL.
 * - the rotation-chain recursive CTE in
 *   `packages/billing/src/resource-entitlements.live.ts` resolves selected
 *   parents to their current leaf at commit time.
 * - the seed inventory registration in
 *   `packages/capabilities/src/developer-platform/api-token-registry.seed.ts`
 *   filters the same leaves in memory.
 */

/** The rotation columns the predicates read, as plain nullable inputs. */
export type TokenLifecycle = {
  readonly revokedAt: string | null
  readonly expiresAt: string | null
  readonly replacedByTokenId: string | null
}

/** Whether the token row was revoked; a revoked row never returns. */
function isRevokedToken(token: TokenLifecycle): boolean {
  return token.revokedAt !== null
}

/** Whether the token was rotated out; only its replacement chain is usable. */
function isRotatedToken(token: TokenLifecycle): boolean {
  return token.replacedByTokenId !== null
}

/**
 * Whether a stored expiry has passed. Invalid persisted timestamps fail
 * closed too: a row that cannot prove a future expiry reads as expired.
 */
export function isExpiredToken(expiresAt: string | null, now: number): boolean {
  return expiresAt !== null && !(Date.parse(expiresAt) > now)
}

/**
 * The live-leaf predicate: a token that still counts against its plan and
 * may act — not revoked, not rotated out, and not expired. Admission,
 * selection and dispatch authority all reduce to this set of rows.
 */
export function isActiveLeafToken(token: TokenLifecycle, now: number): boolean {
  return (
    !isRevokedToken(token) &&
    !isRotatedToken(token) &&
    !isExpiredToken(token.expiresAt, now)
  )
}
