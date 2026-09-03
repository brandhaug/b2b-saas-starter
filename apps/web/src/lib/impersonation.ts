import { useRouteContext } from '@tanstack/react-router'
import { Option, Schema } from 'effect'
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
const ImpersonatedRouteContext = Schema.Struct({
  session: Schema.Struct({
    user: Schema.Struct({ name: Schema.String, email: Schema.String }),
    impersonatedBy: Schema.NullOr(Schema.String)
  })
})

type ImpersonatedRouteContext = typeof ImpersonatedRouteContext.Type

const decodeRouteContext = Schema.decodeUnknownOption(ImpersonatedRouteContext)

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
