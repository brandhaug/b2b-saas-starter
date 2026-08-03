import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, waitingListApplications } from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { CustomerEngagement, WaitingListApplicationNotFound } from './index.ts'

type Application = typeof import('./index.ts').WaitingListApplication.Type

export const SeedCustomerEngagement = (
  records: readonly Application[] = []
): Layer.Layer<CustomerEngagement> =>
  Layer.succeed(CustomerEngagement)({
    findWaitingListApplication: (applicationId) => {
      const application = records.find((record) => record.id === applicationId)
      return application
        ? Effect.succeed(application)
        : Effect.fail(new WaitingListApplicationNotFound({ applicationId }))
    }
  })

export const LiveCustomerEngagement: Layer.Layer<CustomerEngagement, never, Database> =
  Layer.effect(
    CustomerEngagement,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        findWaitingListApplication: (applicationId) =>
          Effect.flatMap(
            orUnavailable('customer-engagement')(
              db
                .select()
                .from(waitingListApplications)
                .where(eq(waitingListApplications.id, applicationId))
                .limit(1)
            ),
            ([application]) =>
              application
                ? Effect.succeed({
                    id: application.id,
                    shopId: application.shopId,
                    status: application.status,
                    expiresAt: application.expiresAt
                  })
                : Effect.fail(new WaitingListApplicationNotFound({ applicationId }))
          )
      }
    })
  )
