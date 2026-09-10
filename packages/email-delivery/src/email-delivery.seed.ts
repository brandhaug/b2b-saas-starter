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
        let limit: number | undefined = filter.limit ?? 100
        if (filter.limit === null) {
          limit = undefined
        }
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
                (filter.purpose === undefined || row.purpose === filter.purpose)
            )
            .toSorted(
              (a, b) =>
                -(a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
            )
            .slice(0, limit)
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
