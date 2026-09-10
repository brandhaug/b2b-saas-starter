import { isStrongAuthenticationError } from '@/lib/ui-error'
import { Link, useParams, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { FORBIDDEN_ERROR_NAME } from '@/lib/capability-error'
import { WorkspaceShell } from '@/components/workspace-shell'
import { m } from '@b2b-saas-starter/i18n/messages'
import { StrongAuthenticationNotice } from './strong-authentication-notice'

/**
 * The copy one workspace page shows when its own read fails. Message
 * accessors, not strings: the catalog function has to run during render so
 * the request's locale decides the language (see docs/i18n.md).
 */
export type WorkspaceRouteErrorCopy = {
  /** The read permission was denied — an expected state, not a fault. */
  readonly deniedTitle: () => string
  readonly deniedDescription: () => string
  /** Anything else: the page could not be loaded and a retry may work. */
  readonly failedTitle: () => string
  readonly failedDescription: () => string
}

/**
 * Builds the `errorComponent` for a workspace page whose loader hard-gates on
 * its own read permission (`auditLog:read`, `apiToken:list`, `webhook:list`).
 *
 * A denial is one of the page's intended states, so it renders as the page:
 * inside the workspace shell, with the sidebar, the header and `<main>` the
 * rest of the app has, rather than as a bare crash screen. The shell keeps its
 * own `SupportDetails` block, so this body carries only the explanation and
 * the ways out.
 *
 * Call it at module scope in the route file: it captures message *functions*,
 * never their evaluated text.
 *
 * The SSR document still carries 500 for a denial, and that is TanStack's
 * floor rather than an oversight: `router-core`'s server lane answers 500 for
 * any errored match (`applyFailure` in `load-server.js`) and the stream
 * renderer takes the response status straight from it, so an `errorComponent`
 * cannot change it. Turning a denial into a 200 means not failing the loader
 * at all — a payload discriminant instead of a hard gate — which is a
 * different authorization contract. Left as is deliberately.
 */
export function workspaceRouteError(copy: WorkspaceRouteErrorCopy) {
  function WorkspaceRouteError({ error }: { readonly error: Error }) {
    const router = useRouter()
    // Read leniently: the boundary can also mount above the matched route,
    // where the slug param does not exist. The shell then anchors its sidebar
    // to the last visited workspace instead of emptying the column.
    const { workspaceSlug } = useParams({ strict: false })
    if (isStrongAuthenticationError(error)) {
      return <StrongAuthenticationNotice />
    }
    const forbidden = error.name === FORBIDDEN_ERROR_NAME
    return (
      <WorkspaceShell workspaceSlug={workspaceSlug ?? null} viewer={null}>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              <h1>{forbidden ? copy.deniedTitle() : copy.failedTitle()}</h1>
            </EmptyTitle>
            <EmptyDescription>
              {forbidden ? copy.deniedDescription() : copy.failedDescription()}
            </EmptyDescription>
          </EmptyHeader>
          {forbidden ? null : (
            <Button variant="outline" onClick={() => void router.invalidate()}>
              {m.try_again()}
            </Button>
          )}
          <Link
            to="/workspaces"
            className="inline-flex items-center text-primary underline underline-offset-4 max-md:min-h-11"
          >
            {m.back_to_workspaces()}
          </Link>
          <Link
            to="/help"
            reloadDocument
            className="inline-flex items-center text-primary underline underline-offset-4 max-md:min-h-11"
          >
            {m.public_meta_support()}
          </Link>
        </Empty>
      </WorkspaceShell>
    )
  }
  return WorkspaceRouteError
}
