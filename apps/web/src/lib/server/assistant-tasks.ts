import { type WebhookInvestigationTask } from '@b2b-saas-starter/capabilities/developer-platform/webhook-investigation-tasks'
import { createServerFn } from '@tanstack/react-start'
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

export const createAssistantTaskServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(CreateTaskInput))
  .handler(async ({ data }): Promise<WebhookInvestigationTask> => {
    const { createAssistantTaskHandler } = await import('./assistant-tasks.effects')
    return createAssistantTaskHandler(data)
  })

export const getAssistantTaskServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(TaskInput))
  .handler(async ({ data }): Promise<WebhookInvestigationTask> => {
    const { getAssistantTaskHandler } = await import('./assistant-tasks.effects')
    return getAssistantTaskHandler(data)
  })

export const approveAssistantTaskServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(TaskInput))
  .handler(async ({ data }): Promise<WebhookInvestigationTask> => {
    const { approveAssistantTaskHandler } = await import('./assistant-tasks.effects')
    return approveAssistantTaskHandler(data)
  })

export const cancelAssistantTaskServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(TaskInput))
  .handler(async ({ data }): Promise<WebhookInvestigationTask> => {
    const { cancelAssistantTaskHandler } = await import('./assistant-tasks.effects')
    return cancelAssistantTaskHandler(data)
  })
