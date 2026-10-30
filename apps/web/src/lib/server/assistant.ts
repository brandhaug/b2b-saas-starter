import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/assistant'
import { type WebhookInvestigationTask } from '@b2b-saas-starter/capabilities/developer-platform/webhook-investigation-tasks'
import { type AssistantProvider } from '@b2b-saas-starter/ai'
import { type WorkspaceViewer } from '@/lib/permissions'
import { Schema } from 'effect'

export type AssistantPagePayload = {
  readonly viewer: WorkspaceViewer | null
  readonly configured: boolean
  readonly investigations?: {
    readonly tasks: ReadonlyArray<WebhookInvestigationTask>
    readonly deliveries: ReadonlyArray<{
      readonly id: string
      readonly endpointId: string
      readonly endpointUrl: string
      readonly eventType: string
      readonly status: string
    }>
  } | null
}

const AssistantPageInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

// All input constraints live in the schema — mirrors AssistantPrompt in
// `packages/ai` so the UI cannot send what the capability would refuse.
const AskAssistantInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  question: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  taskId: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
  )
})

export type AssistantPageInput = typeof AssistantPageInput.Type
export type AskAssistantInput = typeof AskAssistantInput.Type

export type AssistantAnswered = Extract<AskAssistantOutcome, { readonly ok: true }>

export type AssistantRefused = Extract<AskAssistantOutcome, { readonly ok: false }>

export type AskAssistantOutcome =
  | {
      readonly ok: true
      readonly answer: string
      readonly provider: AssistantProvider
      readonly modelId: string
    }
  | {
      readonly ok: false
      readonly reason: 'unconfigured' | 'unavailable'
      readonly message: string
    }

export const Api = HttpApi.make('web-assistant').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadAssistantPageServerFn',
      '/api/web/loadAssistantPageServerFn',
      {
        payload: AssistantPageInput,
        success: Responses.loadAssistantPageServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post('askAssistantServerFn', '/api/web/askAssistantServerFn', {
      payload: AskAssistantInput,
      success: Responses.askAssistantServerFnResponse,
      error: WebErrors
    })
  )
)

const browser = makeBrowserClient(Api)

export const loadAssistantPageServerFn = dataCall(
  browser,
  AssistantPageInput,
  (client, payload) => client.calls.loadAssistantPageServerFn({ payload })
)
