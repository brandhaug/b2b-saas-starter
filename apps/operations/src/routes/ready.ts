import { createFileRoute } from '@tanstack/react-router'
import { handleOperationsHttp } from '@/lib/server/operations-http.ts'

export const Route = createFileRoute('/ready')({
  server: { handlers: { GET: ({ request }) => handleOperationsHttp(request) } }
})
