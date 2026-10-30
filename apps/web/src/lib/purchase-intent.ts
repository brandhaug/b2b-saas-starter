/** A catalog identifier only. Prices, quantities and authority stay server-owned. */
export type PurchaseIntent = { readonly planId: 'team' }

export function purchaseIntent(plan: string | undefined): PurchaseIntent | null {
  return plan === 'team' ? { planId: plan } : null
}
