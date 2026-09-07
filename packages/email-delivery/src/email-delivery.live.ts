import { emailDeliveries, user } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { and, asc, desc, eq, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { orUnavailable } from '@b2b-saas-starter/failure/capability'
import { EmailDelivery } from './email-delivery.ts'
import { makeEmailDelivery, type DeliveryStore } from './email-delivery.internal.ts'

export const LiveEmailDelivery = Layer.effect(
  EmailDelivery,
  Effect.gen(function* () {
    const db = yield* Database
    const unavailable = orUnavailable('EmailDelivery')
    const store: DeliveryStore = {
      get: Effect.fn('LiveEmailDelivery.get')(function* (id) {
        const rows = yield* db
          .select()
          .from(emailDeliveries)
          .where(eq(emailDeliveries.id, id))
          .limit(1)
          .pipe(unavailable)
        return rows[0] ?? null
      }),
      list: Effect.fn('LiveEmailDelivery.list')(function* (filter) {
        const conditions: Array<SQL> = []
        if (filter.userId !== undefined) {
          conditions.push(eq(emailDeliveries.userId, filter.userId))
        }
        if (filter.workspaceId !== undefined) {
          conditions.push(eq(emailDeliveries.workspaceId, filter.workspaceId))
        }
        if (filter.messageId !== undefined) {
          conditions.push(eq(emailDeliveries.providerMessageId, filter.messageId))
        }
        if (filter.recipient !== undefined) {
          conditions.push(eq(emailDeliveries.recipient, filter.recipient))
        }
        if (filter.referenceId !== undefined) {
          conditions.push(eq(emailDeliveries.referenceId, filter.referenceId))
        }
        if (filter.purpose !== undefined) {
          conditions.push(eq(emailDeliveries.purpose, filter.purpose))
        }
        if (filter.createdBefore !== undefined) {
          conditions.push(lte(emailDeliveries.createdAt, filter.createdBefore))
        }
        if (filter.statuses !== undefined) {
          conditions.push(inArray(emailDeliveries.status, [...filter.statuses]))
        }
        let order = [desc(emailDeliveries.createdAt), desc(emailDeliveries.id)]
        if (filter.createdBefore !== undefined) {
          order = [asc(emailDeliveries.createdAt), asc(emailDeliveries.id)]
        }
        return yield* db
          .select()
          .from(emailDeliveries)
          .where(and(...conditions))
          .orderBy(...order)
          .limit(filter.limit ?? 100)
          .pipe(unavailable)
      }),
      put: Effect.fn('LiveEmailDelivery.put')(function* (row, revision) {
        if (revision === null) {
          const changed = yield* db
            .insert(emailDeliveries)
            .values(row)
            .onConflictDoNothing()
            .returning({ id: emailDeliveries.id })
            .pipe(unavailable)
          return changed.length === 1
        }
        const changed = yield* db
          .update(emailDeliveries)
          .set(row)
          .where(
            and(eq(emailDeliveries.id, row.id), eq(emailDeliveries.revision, revision))
          )
          .returning({ id: emailDeliveries.id })
          .pipe(unavailable)
        return changed.length === 1
      }),
      remove: Effect.fn('LiveEmailDelivery.remove')(function* (expired) {
        let count = 0
        // Two bound parameters per row, below D1's 100-parameter statement cap.
        for (let start = 0; start < expired.length; start += 45) {
          const chunk = expired.slice(start, start + 45)
          const changed = yield* db
            .delete(emailDeliveries)
            .where(
              or(
                ...chunk.map((row) =>
                  and(
                    eq(emailDeliveries.id, row.id),
                    eq(emailDeliveries.revision, row.revision)
                  )
                )
              )
            )
            .returning({ id: emailDeliveries.id })
            .pipe(unavailable)
          count += changed.length
        }
        return count
      }),
      resolveUserId: Effect.fn('LiveEmailDelivery.resolveUserId')(function* (email) {
        const rows = yield* db
          .select({ id: user.id })
          .from(user)
          .where(sql`lower(${user.email}) = ${email.toLowerCase().trim()}`)
          .limit(1)
          .pipe(unavailable)
        return rows[0]?.id ?? null
      })
    }
    return makeEmailDelivery(store)
  })
)
