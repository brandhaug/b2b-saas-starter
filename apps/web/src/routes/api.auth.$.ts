import { createFileRoute } from '@tanstack/react-router'
import { handleAuth } from '@/lib/server/auth-http'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request)
    }
  }
})
