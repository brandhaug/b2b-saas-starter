import { DateTime, Effect, Layer, Ref } from 'effect'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  investigationTransition,
  makeInvestigationTasks,
  WebhookInvestigationTasks,
  type WebhookInvestigationTask
} from './webhook-investigation-tasks.ts'

export const SeedWebhookInvestigationTasks = Layer.effect(WebhookInvestigationTasks)(
  Effect.gen(function* () {
    const audit = yield* AuditEventLog
    const rows = yield* Ref.make<
      ReadonlyArray<{
        readonly workspaceId: string
        readonly task: WebhookInvestigationTask
      }>
    >([])
    return yield* makeInvestigationTasks({
      get: (workspaceId, taskId) =>
        Ref.get(rows).pipe(
          Effect.map(
            (items) =>
              items.find(
                (row) => row.workspaceId === workspaceId && row.task.id === taskId
              )?.task ?? null
          )
        ),
      list: (workspaceId) =>
        Ref.get(rows).pipe(
          Effect.map((items) =>
            items
              .flatMap((row) => {
                if (row.workspaceId === workspaceId) {
                  return [row.task]
                }
                return []
              })
              .toSorted(
                (a, b) =>
                  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
              )
              .slice(0, 30)
          )
        ),
      insert: Effect.fn('InvestigationTaskStore.insert')(function* (task) {
        const ctx = yield* WorkspaceContext
        yield* Ref.update(rows, (items) => [
          ...items,
          { workspaceId: ctx.workspace.id, task }
        ])
        yield* audit.record({
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.actor?.userId ?? null,
          actorType: ctx.actorType,
          eventType: 'assistant_task.created',
          targetType: 'assistant_task',
          targetId: task.id,
          metadata: { sourceDeliveryId: task.sourceDeliveryId }
        })
      }),
      transition: Effect.fn('InvestigationTaskStore.transition')(
        function* (task, status) {
          const ctx = yield* WorkspaceContext
          const updatedAt = DateTime.formatIso(yield* DateTime.now)
          const change = investigationTransition(task.id, status)
          const won = yield* Ref.modify(rows, (items) => {
            const current = items.find(
              (row) => row.workspaceId === ctx.workspace.id && row.task.id === task.id
            )
            if (current?.task.status !== 'proposed') {
              return [false, items]
            }
            return [
              true,
              items.map((row) => {
                if (row !== current) {
                  return row
                }
                return {
                  ...row,
                  task: {
                    ...row.task,
                    status,
                    updatedAt,
                    replayDeliveryId: change.replayDeliveryId
                  }
                }
              })
            ]
          })
          if (won) {
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              actorType: ctx.actorType,
              eventType: change.eventType,
              targetType: 'assistant_task',
              targetId: task.id,
              metadata: { sourceDeliveryId: task.sourceDeliveryId }
            })
          }
          return won
        }
      )
    })
  })
)
