import { createFileRoute } from '@tanstack/react-router'
import { answeringLocalD1 } from '@/lib/server/auth-local-d1'
import { serveOAuthDiscovery } from '@/lib/server/oauth-discovery'

// `/.well-known/oauth-authorization-server/api/auth` — the RFC 8414 location for
// an issuer with a path (ADR 0068). The splat is the issuer path; the document
// itself comes from Better Auth. See `lib/server/oauth-discovery.ts`. The
// `answeringLocalD1` guard turns an escaped no-D1 defect into the 503 guidance
// response instead of a stack-traced 500 (see `lib/server/auth-local-d1.ts`).
export const Route = createFileRoute('/.well-known/oauth-authorization-server/$')({
  server: {
    handlers: {
      GET: ({ request }) => answeringLocalD1(() => serveOAuthDiscovery(request))
    }
  }
})
