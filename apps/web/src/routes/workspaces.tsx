import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@/lib/server/auth'

// Layout route for the /workspaces subtree: the auth gate runs ONCE here and
// children (index, $workspaceSlug, settings) read `context.session` instead
// of re-gating. `location.href` is the full target location, so the
// `?redirect=` round-trip through /sign-in is preserved (asserted by
// e2e/smoke.spec.ts). /admin keeps its own gate — it needs `requireAdmin`.
export const Route = createFileRoute('/workspaces')({
  beforeLoad: async ({ location }) => {
    const session = await requireSession(location.href)
    return { session }
  }
})
