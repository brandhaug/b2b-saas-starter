import { createFileRoute } from '@tanstack/react-router'
import { answeringLocalD1 } from '@/lib/server/auth-local-d1'
import { serveOAuthDiscovery } from '@/lib/server/oauth-discovery'

// The bare well-known root, which some clients try before the path-inserted
// form. Better Auth answers it too when the issuer has no path; with `/api/auth`
// as the issuer it is a 404 from the same handler — honest either way. The
// `answeringLocalD1` guard turns an escaped no-D1 defect into the 503 guidance
// response instead of a stack-traced 500 (see `lib/server/auth-local-d1.ts`).
export const Route = createFileRoute('/.well-known/oauth-authorization-server')({
  server: {
    handlers: {
      GET: ({ request }) => answeringLocalD1(() => serveOAuthDiscovery(request))
    }
  }
})
