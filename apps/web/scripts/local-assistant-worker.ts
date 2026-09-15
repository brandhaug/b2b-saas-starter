export { WorkspaceAssistantConversation } from '../src/lib/assistant/conversation-host'

// Only the verified in-process namespace binding can reach a conversation.
export default {
  fetch() {
    return new Response('Not found', { status: 404 })
  }
}
