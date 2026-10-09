import { pickOptionalStrings } from './utils'

/** A catalog identifier only. Prices, quantities and authority stay server-owned. */
export type PurchaseIntent = { readonly planId: 'team' }

export function purchaseIntent(plan: string | undefined): PurchaseIntent | null {
  return plan === 'team' ? { planId: plan } : null
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Router search is untrusted; narrow strings before interpreting the intent.
export function purchaseSearch(search: unknown): { plan?: string | undefined } {
  return pickOptionalStrings(search, ['plan'])
}
