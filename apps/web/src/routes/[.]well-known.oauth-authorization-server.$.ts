import { createFileRoute } from '@tanstack/react-router'
import { serveOAuthDiscovery } from '@/lib/server/oauth-discovery'

// `/.well-known/oauth-authorization-server/api/auth` — the RFC 8414 location for
// an issuer with a path (ADR 0054). The splat is the issuer path; the document
// itself comes from Better Auth. See `lib/server/oauth-discovery.ts`.
export const Route = createFileRoute('/.well-known/oauth-authorization-server/$')({
  server: {
    handlers: {
      GET: ({ request }) => serveOAuthDiscovery(request)
    }
  }
})
