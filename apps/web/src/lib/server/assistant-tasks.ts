import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/assistant-tasks'
import { Schema } from 'effect'

const CreateTaskInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  deliveryId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  question: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000))
})
const TaskInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  taskId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
})
export type CreateTaskInput = typeof CreateTaskInput.Type
export type TaskInput = typeof TaskInput.Type

export const Api = HttpApi.make('web-assistant-tasks').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'createAssistantTaskServerFn',
      '/api/web/createAssistantTaskServerFn',
      {
        payload: CreateTaskInput,
        success: Responses.createAssistantTaskServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'getAssistantTaskServerFn',
      '/api/web/getAssistantTaskServerFn',
      {
        payload: TaskInput,
        success: Responses.getAssistantTaskServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'approveAssistantTaskServerFn',
      '/api/web/approveAssistantTaskServerFn',
      {
        payload: TaskInput,
        success: Responses.approveAssistantTaskServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'cancelAssistantTaskServerFn',
      '/api/web/cancelAssistantTaskServerFn',
      {
        payload: TaskInput,
        success: Responses.cancelAssistantTaskServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const createAssistantTaskServerFn = dataCall(
  browser,
  CreateTaskInput,
  (client, payload) => client.calls.createAssistantTaskServerFn({ payload })
)

export const getAssistantTaskServerFn = dataCall(
  browser,
  TaskInput,
  (client, payload) => client.calls.getAssistantTaskServerFn({ payload })
)

export const approveAssistantTaskServerFn = dataCall(
  browser,
  TaskInput,
  (client, payload) => client.calls.approveAssistantTaskServerFn({ payload })
)

export const cancelAssistantTaskServerFn = dataCall(
  browser,
  TaskInput,
  (client, payload) => client.calls.cancelAssistantTaskServerFn({ payload })
)
