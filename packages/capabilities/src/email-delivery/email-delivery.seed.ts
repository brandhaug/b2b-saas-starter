import { Effect, Layer } from 'effect'
import { EmailDelivery } from './email-delivery.ts'
import {
  makeEmailDelivery,
  type DeliveryStore,
  type StoredDelivery
} from './email-delivery.internal.ts'

export function SeedEmailDelivery(
  users: ReadonlyArray<{ readonly id: string; readonly email: string }> = []
) {
  return Layer.sync(EmailDelivery, () => {
    const rows = new Map<string, StoredDelivery>()
    const store: DeliveryStore = {
      get: Effect.fn('SeedEmailDelivery.get')((id) =>
        Effect.sync(() => rows.get(id) ?? null)
      ),
      list: Effect.fn('SeedEmailDelivery.list')((filter) => {
        const statuses = new Set(filter.statuses)
        return Effect.sync(() =>
          [...rows.values()]
            .filter(
              (row) =>
                (filter.userId === undefined || row.userId === filter.userId) &&
                (filter.workspaceId === undefined ||
                  row.workspaceId === filter.workspaceId) &&
                (filter.messageId === undefined ||
                  row.providerMessageId === filter.messageId) &&
                (filter.recipient === undefined ||
                  row.recipient === filter.recipient) &&
                (filter.referenceId === undefined ||
                  row.referenceId === filter.referenceId) &&
                (filter.purpose === undefined || row.purpose === filter.purpose) &&
                (filter.createdBefore === undefined ||
                  row.createdAt <= filter.createdBefore) &&
                (filter.statuses === undefined || statuses.has(row.status))
            )
            .toSorted(
              (a, b) =>
                b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
            )
            .slice(0, filter.limit ?? 100)
        )
      }),
      put: Effect.fn('SeedEmailDelivery.put')((row, revision) =>
        Effect.sync(() => {
          const old = rows.get(row.id)
          if (
            (revision === null && old) ||
            (revision !== null && old?.revision !== revision)
          ) {
            return false
          }
          rows.set(row.id, row)
          return true
        })
      ),
      remove: Effect.fn('SeedEmailDelivery.remove')((expired) =>
        Effect.sync(() => {
          let count = 0
          for (const row of expired) {
            if (rows.get(row.id)?.revision === row.revision && rows.delete(row.id)) {
              count++
            }
          }
          return count
        })
      ),
      resolveUserId: Effect.fn('SeedEmailDelivery.resolveUserId')((email) =>
        Effect.succeed(
          users.find((user) => user.email.toLowerCase() === email.toLowerCase().trim())
            ?.id ?? null
        )
      )
    }
    return makeEmailDelivery(store)
  })
}
