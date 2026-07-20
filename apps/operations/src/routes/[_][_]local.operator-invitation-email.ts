import { createFileRoute } from '@tanstack/react-router'
import { handleOperationsHttp } from '@/lib/server/operations-http.ts'

export const Route = createFileRoute('/__local/operator-invitation-email')({
  server: { handlers: { GET: ({ request }) => handleOperationsHttp(request) } }
})
