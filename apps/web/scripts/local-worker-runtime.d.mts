import { type Miniflare } from 'miniflare'
import { type ConversationNamespace } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation-transport'
import { type D1Database } from '@cloudflare/workers-types'
export function localWorkerBindings(): Promise<
  | {
      DB: D1Database
      ASSISTANT_CONVERSATIONS: ConversationNamespace
    }
  | undefined
>
export function disposeLocalWorker(): Promise<void>

export function localConversationNamespace(
  namespace: Awaited<ReturnType<Miniflare['getDurableObjectNamespace']>>
): ConversationNamespace
