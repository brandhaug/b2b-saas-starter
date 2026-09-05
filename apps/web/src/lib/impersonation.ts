import { useRouteContext } from '@tanstack/react-router'
import { Option } from 'effect'
import { stopImpersonatingServerFn } from '@/lib/server/admin'

/**
 * What the shell's banner shows while a System Admin impersonates a user
 * (ADR 0054): who the session currently is. The admin's own identity is not
 * on the client payload — `impersonatedBy` is an id, and the banner addresses
 * the admin reading it, who knows who they are.
 */
export type ImpersonationState = {
  readonly userName: string
  readonly userEmail: string
}

/** The banner's one server call, as a port (see `auth-client-ports.ts` for the rationale). */
export type StopImpersonating = () => Promise<void>

export function stopImpersonatingWithServerFn(): Promise<void> {
  return stopImpersonatingServerFn()
}

/**
 * The slice of a gated route's context the banner reads: the `session` that
 * `requireSession` / `requireAdmin` return from `beforeLoad`. Decoded rather
 * than asserted, because `useRouteContext({ strict: false })` hands back the
 * union of every route's context and a public page carries no session at all.
 */
type ImpersonatedRouteContext = {
  readonly session: {
    readonly user: {
      readonly name: string
      readonly email: string
    }
    readonly impersonatedBy: string | null
  }
}

/**
 * A plain shape check, deliberately not an `effect/Schema` decode: unlike a
 * server fn's `.validator()` (stripped from the client build by the TanStack
 * compiler — see apps/web/AGENTS.md), this decode runs *in the browser* on
 * every workspace page, so an `effect/Schema` construct here would ship the
 * Schema runtime unconditionally. Same tier as `pickOptionalStrings`
 * (lib/utils.ts): a value that is not session-shaped is the Option-none the
 * old decode produced.
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function decodeRouteContext(context: unknown): Option.Option<ImpersonatedRouteContext> {
  if (!isRecord(context)) {
    return Option.none()
  }
  const session = context.session
  if (!isRecord(session)) {
    return Option.none()
  }
  const user = session.user
  if (
    !isRecord(user) ||
    typeof user.name !== 'string' ||
    typeof user.email !== 'string'
  ) {
    return Option.none()
  }
  const impersonatedBy = session.impersonatedBy
  if (typeof impersonatedBy !== 'string' && impersonatedBy !== null) {
    return Option.none()
  }
  return Option.some({
    session: { user: { name: user.name, email: user.email }, impersonatedBy }
  })
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type

/** Pure half of {@link useImpersonation}: the banner state for a decoded route context. */
export function impersonationOf(
  routeContext: Option.Option<ImpersonatedRouteContext>
): ImpersonationState | null {
  if (
    Option.isNone(routeContext) ||
    routeContext.value.session.impersonatedBy === null
  ) {
    return null
  }
  return {
    userName: routeContext.value.session.user.name,
    userEmail: routeContext.value.session.user.email
  }
}

/**
 * The impersonation state of the route the shell is rendered under, read
 * from the router rather than threaded as a prop: every gated route already
 * puts `session` on its context, and the banner must show on all of them —
 * a prop would be one more line on a dozen routes that says the same thing.
 */
export function useImpersonation(): ImpersonationState | null {
  return impersonationOf(decodeRouteContext(useRouteContext({ strict: false })))
}
