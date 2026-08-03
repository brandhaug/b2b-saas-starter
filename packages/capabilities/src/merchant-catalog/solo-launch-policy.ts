export const merchantCatalogSoloLaunchPolicy = {
  plan: 'solo',
  ownerRole: 'owner',
  membershipCommands: ['resolveForUser', 'resolveBySlug'],
  maximumActiveProviders: 1,
  providerCommands: ['updateProvider']
} as const

export const isSoloOwnerProvider = (provider: {
  readonly isDefault: boolean
  readonly status: 'active' | 'inactive'
}): boolean => provider.isDefault && provider.status === 'active'
