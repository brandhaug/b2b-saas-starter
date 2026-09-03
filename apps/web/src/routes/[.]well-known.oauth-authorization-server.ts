import { createFileRoute } from '@tanstack/react-router'
import { serveOAuthDiscovery } from '@/lib/server/oauth-discovery'

// The bare well-known root, which some clients try before the path-inserted
// form. Better Auth answers it too when the issuer has no path; with `/api/auth`
// as the issuer it is a 404 from the same handler — honest either way.
export const Route = createFileRoute('/.well-known/oauth-authorization-server')({
  server: {
    handlers: {
      GET: ({ request }) => serveOAuthDiscovery(request)
    }
  }
})
