import { createFileRoute } from '@tanstack/react-router'
import { handleOperationsHttp } from '@/lib/server/operations-http.ts'

export const Route = createFileRoute('/api/operations/$')({
  server: { handlers: { GET: ({ request }) => handleOperationsHttp(request) } }
})
