import { WebhookInvestigationTasks } from '@b2b-saas-starter/capabilities/developer-platform/webhook-investigation-tasks'
import { Effect } from 'effect'
import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { type CreateTaskInput, type TaskInput } from './assistant-tasks'

export async function createAssistantTaskHandler(input: CreateTaskInput) {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ assistant: ['read'] })
      yield* requireWorkspacePermission({ webhook: ['list'] })
      const tasks = yield* WebhookInvestigationTasks
      return yield* tasks.create({
        deliveryId: input.deliveryId,
        question: input.question
      })
    }),
    { userId: session.user.id }
  )
}

export async function getAssistantTaskHandler(input: TaskInput) {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ assistant: ['read'] })
      yield* requireWorkspacePermission({ webhook: ['list'] })
      const tasks = yield* WebhookInvestigationTasks
      return yield* tasks.get({ taskId: input.taskId })
    }),
    { userId: session.user.id }
  )
}

export async function approveAssistantTaskHandler(input: TaskInput) {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ assistant: ['read'] })
      yield* requireWorkspacePermission({ webhook: ['list'] })
      yield* requireWorkspacePermission({ webhook: ['replay'] })
      const tasks = yield* WebhookInvestigationTasks
      return yield* tasks.approve({ taskId: input.taskId })
    }),
    { userId: session.user.id }
  )
}

export async function cancelAssistantTaskHandler(input: TaskInput) {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ assistant: ['read'] })
      yield* requireWorkspacePermission({ webhook: ['list'] })
      yield* requireWorkspacePermission({ webhook: ['replay'] })
      const tasks = yield* WebhookInvestigationTasks
      return yield* tasks.cancel({ taskId: input.taskId })
    }),
    { userId: session.user.id }
  )
}
