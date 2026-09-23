import { ConversationUnavailable } from '../developer-platform/assistant-conversation.ts'
import { Effect, Layer } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db/service'
import { type AssistantDirectory } from './directory.ts'
import { LiveAssistantDirectory } from './directory.live.ts'
import { type AssistantAdmission } from './admission.ts'
import { LiveAssistantAdmission } from './admission.live.ts'
import { type AuditEventLog } from '../governance/audit-event-log.ts'
import { LiveAuditEventLog } from '../governance/audit-event-log.live.ts'
import {
  type AssistantAuthority,
  LiveAssistantAuthority
} from '../developer-platform/assistant-authority.ts'
import { LiveMcpClientConnections } from '../developer-platform/mcp-client-connections.live.ts'
import { type AssistantTaskEvidence } from '../developer-platform/assistant-task-evidence.ts'
import { LiveAssistantTaskEvidence } from '../developer-platform/assistant-task-evidence.live.ts'

export type ConversationHostServices =
  | AssistantDirectory
  | AssistantAdmission
  | AssistantAuthority
  | AssistantTaskEvidence
  | AuditEventLog

/** Native transcript hosts need current authority, admission and evidence, never feature mutation graphs. */
export function LiveConversationHost(assistantResource?: string) {
  const audit = LiveAuditEventLog
  const connections = LiveMcpClientConnections().pipe(Layer.provide(audit))
  return Layer.mergeAll(
    audit,
    LiveAssistantDirectory().pipe(Layer.provide(audit)),
    LiveAssistantAdmission.pipe(Layer.provide(audit)),
    LiveAssistantAuthority(assistantResource).pipe(Layer.provide(connections)),
    LiveAssistantTaskEvidence
  )
}

export function makeConversationHostLayer(env: {
  readonly DB?: Parameters<typeof layerFromD1>[0] | undefined
  readonly assistantResource?: string | undefined
}): Layer.Layer<ConversationHostServices, ConversationUnavailable> {
  if (env.DB === undefined) {
    return Layer.effectContext<
      ConversationHostServices,
      ConversationUnavailable,
      never
    >(Effect.fail(new ConversationUnavailable({ reason: 'configuration' })))
  }
  return LiveConversationHost(env.assistantResource).pipe(
    Layer.provide(layerFromD1(env.DB))
  )
}
