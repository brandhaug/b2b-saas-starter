import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { type DisplayedPlan } from '@b2b-saas-starter/billing/billing'

const PurchaseInput = Schema.Struct({ planId: Schema.Literal('team') })
const PurchaseCheckoutInput = Schema.Struct({
  ...PurchaseInput.fields,
  workspaceSlug: Schema.NonEmptyString
})
export type PurchaseInput = typeof PurchaseInput.Type
export type PurchasePayload = {
  readonly plan: DisplayedPlan | null
  readonly stripeConfigured: boolean
  readonly emailVerificationRequired: boolean
  readonly workspaces: ReadonlyArray<{ readonly slug: string; readonly name: string }>
}

export const loadPurchaseServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(PurchaseInput))
  .handler(async ({ data }): Promise<PurchasePayload> => {
    const { loadPurchaseHandler } = await import('./purchase.effects')
    return loadPurchaseHandler(data)
  })

export const continuePurchaseServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(PurchaseCheckoutInput))
  .handler(async ({ data }): Promise<{ url: string }> => {
    const { startCheckoutHandler } = await import('./billing.effects')
    return startCheckoutHandler(data, data)
  })
