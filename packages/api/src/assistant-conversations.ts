import { ConversationInputRejected } from '@b2b-saas-starter/ai/conversation-context'
import { type AssistantOAuthPrincipal } from '@b2b-saas-starter/authz/assistant-access-token'
import { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { AssistantAdmissionRefused } from '@b2b-saas-starter/capabilities/assistant/admission'
import {
  ConversationAcceptance,
  ConversationAttempt,
  ConversationConflict,
  ConversationList,
  ConversationNotFound,
  ConversationPage,
  ConversationRetry,
  ConversationSend,
  ConversationSummary,
  ConversationUnavailable
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Context, Schema } from 'effect'
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity
} from 'effect/unstable/httpapi'
import { RateLimited, Unauthorized } from './errors.ts'

export class AssistantApiPrincipal extends Context.Service<
  AssistantApiPrincipal,
  AssistantOAuthPrincipal
>()('@b2b-saas-starter/api/AssistantApiPrincipal') {}

/** A verified member credential, never workspace-token creator attribution. */
export class AssistantBearerAuth extends HttpApiMiddleware.Service<
  AssistantBearerAuth,
  {
    provides: AssistantApiPrincipal | WorkspaceContext
  }
>()('@b2b-saas-starter/api/AssistantBearerAuth', {
  security: { assistantBearer: HttpApiSecurity.bearer },
  error: [
    Unauthorized,
    AuthorizationDenied,
    ConversationNotFound,
    RateLimited,
    CapabilityUnavailable
  ]
}) {}

const ConversationParams = Schema.Struct({ conversationId: Schema.String })
const AttemptParams = Schema.Struct({
  ...ConversationParams.fields,
  attemptId: Schema.String
})
const WorkspaceSelection = Schema.Struct({ workspaceSlug: Schema.String })
const ConversationListQuery = Schema.Struct({
  ...WorkspaceSelection.fields,
  cursor: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.NumberFromString)
})
const HistoryQuery = Schema.Struct({ cursor: Schema.optionalKey(Schema.String) })
const RetryPayload = Schema.Struct({
  idempotencyKey: ConversationRetry.fields.idempotencyKey
})
const ObservationHeaders = Schema.Struct({
  'last-event-id': Schema.optionalKey(Schema.String.check(Schema.isMaxLength(512)))
})
const DeletionAccepted = Schema.Struct({ status: Schema.Literal('deleting') })

// oxlint-disable-next-line effect/noAs -- const tuple preserves each declared Effect error schema
const READ_ERRORS = [
  ConversationNotFound,
  ConversationUnavailable,
  CapabilityUnavailable,
  Unauthorized,
  AuthorizationDenied
] as const
// oxlint-disable-next-line effect/noAs -- const tuple preserves each declared Effect error schema
const GENERATION_ERRORS = [
  ...READ_ERRORS,
  ConversationConflict,
  ConversationInputRejected.pipe(HttpApiSchema.status(400)),
  AssistantAdmissionRefused
] as const

export const AssistantConversationsApi = HttpApiGroup.make('assistant-conversations')
  .add(
    HttpApiEndpoint.post('create', '/assistant/conversations', {
      payload: WorkspaceSelection,
      success: ConversationSummary.pipe(HttpApiSchema.status(201)),
      error: READ_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('list', '/assistant/conversations', {
      query: ConversationListQuery,
      success: ConversationList,
      error: READ_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('read', '/assistant/conversations/:conversationId', {
      params: ConversationParams,
      success: ConversationSummary,
      error: READ_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get(
      'history',
      '/assistant/conversations/:conversationId/messages',
      {
        params: ConversationParams,
        query: HistoryQuery,
        success: ConversationPage,
        error: READ_ERRORS
      }
    )
  )
  .add(
    HttpApiEndpoint.post('send', '/assistant/conversations/:conversationId/messages', {
      params: ConversationParams,
      payload: ConversationSend,
      success: ConversationAcceptance.pipe(HttpApiSchema.status(202)),
      error: GENERATION_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.post(
      'retry',
      '/assistant/conversations/:conversationId/attempts/:attemptId/retry',
      {
        params: AttemptParams,
        payload: RetryPayload,
        success: ConversationAcceptance.pipe(HttpApiSchema.status(202)),
        error: GENERATION_ERRORS
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      'stop',
      '/assistant/conversations/:conversationId/attempts/:attemptId/stop',
      { params: AttemptParams, success: ConversationAttempt, error: READ_ERRORS }
    )
  )
  .add(
    HttpApiEndpoint.get(
      'observe',
      '/assistant/conversations/:conversationId/attempts/:attemptId/events',
      {
        params: AttemptParams,
        headers: ObservationHeaders,
        success: HttpApiSchema.StreamUint8Array({ contentType: 'text/event-stream' }),
        error: READ_ERRORS
      }
    )
  )
  .add(
    HttpApiEndpoint.delete('delete', '/assistant/conversations/:conversationId', {
      params: ConversationParams,
      success: DeletionAccepted.pipe(HttpApiSchema.status(202)),
      error: READ_ERRORS
    })
  )
  .middleware(AssistantBearerAuth)
