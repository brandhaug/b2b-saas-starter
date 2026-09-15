import { createFileRoute } from '@tanstack/react-router'
import { connectAssistantConversation } from '@/lib/server/assistant-conversation-socket'

export const Route = createFileRoute('/api/assistant/$conversationId/connect')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        connectAssistantConversation(request, params.conversationId)
    }
  }
})
