import { type EventEmitter } from 'node:events'
export function installAssistantSocketBridge(
  server: Pick<EventEmitter, 'on' | 'off'>,
  connect: (
    request: Request,
    conversationId: string
  ) => Promise<{ status: number; webSocket?: unknown }>
): () => void
