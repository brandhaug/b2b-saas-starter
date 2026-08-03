import { createFileRoute } from '@tanstack/react-router'
import { handleOperationsHttp } from '@/lib/server/operations-http.ts'

export const Route = createFileRoute('/api/members/search')({
  server: { handlers: { GET: ({ request }) => handleOperationsHttp(request) } }
})
