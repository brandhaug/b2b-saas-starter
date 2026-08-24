import { redeliverWebhookDelivery } from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-endpoints.ts'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'

/**
 * Manual webhook redelivery. The capability operation verifies the delivery
 * row is terminal (`failed_permanent` / `dead_lettered`), belongs to this
 * workspace, and still carries its original payload — then re-enqueues it via
 * `WebhookPublisher`. Re-sending events is a write, so it is gated like the
 * other webhook mutations, not `webhook:list`.
 */
const RedeliverInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  deliveryId: Schema.String
})

const decodeRedeliverInput = Schema.decodeUnknownSync(RedeliverInput)

export const redeliverWebhookServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeRedeliverInput(input))
  .handler(async ({ data }): Promise<boolean> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
        yield* requireWorkspacePermission({ webhook: ['create'] })
        return yield* redeliverWebhookDelivery({ deliveryId: data.deliveryId })
      }),
      { userId: session.user.id }
    )
  })
