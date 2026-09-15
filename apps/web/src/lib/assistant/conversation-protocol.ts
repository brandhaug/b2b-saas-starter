import { Schema } from 'effect'
import { AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import {
  ConversationSend,
  ConversationRetry
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'

export const decodeConnectionState = Schema.decodeUnknownEffect(
  Schema.Struct({
    credential: AssistantCredentialReference,
    runAccessRevision: Schema.Int
  })
)
export const decodeInvocation = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      conversationId: Schema.String,
      credential: AssistantCredentialReference
    })
  )
)
export const decodeObservation = Schema.decodeUnknownResult(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.Literals([
        'cf_agent_stream_resume_request',
        'cf_agent_stream_resume_ack'
      ])
    })
  )
)
export const decodeFrame = Schema.decodeUnknownResult(Schema.String)
export const decodeStop = Schema.decodeUnknownEffect(
  Schema.Struct({ attemptId: Schema.String })
)
export const decodeSend = Schema.decodeUnknownEffect(ConversationSend)
export const decodeRetry = Schema.decodeUnknownEffect(ConversationRetry)
const TaggedFailure = Schema.Struct({
  _tag: Schema.Literals([
    'ConversationNotFound',
    'ConversationConflict',
    'ConversationUnavailable',
    'AssistantAdmissionRefused',
    'ConversationInputRejected',
    'SchemaError',
    'AssistantAuthorityDenied',
    'ConversationModelUnavailable'
  ]),
  reason: Schema.optionalKey(
    Schema.Literals([
      'busy',
      'idempotency_key_reused',
      'stale_retry',
      'configuration',
      'storage',
      'provider',
      'authority',
      'concurrency_limit',
      'generation_rate_limit',
      'not_found',
      'credential_expired',
      'scope_required',
      'policy_denied',
      'unconfigured',
      'input_invalid',
      'current_context_budget',
      'history_invalid'
    ])
  ),
  retryAfterSeconds: Schema.optionalKey(Schema.Number)
})
export const decodeFailure = Schema.decodeUnknownResult(TaggedFailure)

export function failureResponse(value: typeof TaggedFailure.Type): Response {
  if (value._tag === 'ConversationModelUnavailable') {
    return Response.json(
      { _tag: 'ConversationUnavailable', reason: 'configuration' },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    )
  }
  let status = 503
  switch (value._tag) {
    case 'ConversationUnavailable': {
      break
    }
    case 'ConversationNotFound': {
      status = 404
      break
    }
    case 'ConversationConflict': {
      status = 409
      break
    }
    case 'AssistantAdmissionRefused': {
      status = 429
      break
    }
    case 'ConversationInputRejected':
    case 'SchemaError': {
      status = 400
      break
    }
    case 'AssistantAuthorityDenied': {
      status = 403
      if (value.reason === 'not_found' || value.reason === 'policy_denied') {
        status = 404
      }
      if (value.reason === 'credential_expired') {
        status = 401
      }
      break
    }
  }
  const headers = new Headers({ 'cache-control': 'no-store' })
  if (value.retryAfterSeconds !== undefined) {
    headers.set('retry-after', String(value.retryAfterSeconds))
  }
  return Response.json(value, { status, headers })
}

const conversationPaths = new Set([
  '/read',
  '/history',
  '/send',
  '/retry',
  '/stop',
  '/events',
  '/export',
  '/connect',
  '/cleanup',
  '/invalidate'
])

/** Reject SDK routing and management endpoints before its lifecycle dispatcher runs. */
export function allowedConversationRequest(request: Request): boolean {
  const path = new URL(request.url).pathname
  if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    return path === '/connect'
  }
  return conversationPaths.has(path)
}
