import { Schema } from 'effect'

export const visualAssetRoles = [
  'navigation-back',
  'navigation-menu',
  'location-nearby',
  'location-search',
  'booking-shop',
  'dismiss',
  'selection-check',
  'calendar-scheduling',
  'service-category',
  'booking-party',
  'typography-body',
  'typography-mono',
  'password-mask',
  'walk-in-illustration',
  'group-appointment-motion',
  'identity-apple',
  'identity-google',
  'calendar-google',
  'calendar-yahoo',
  'payment-card-generic',
  'payment-apple-pay',
  'payment-google-pay',
  'payment-cash-app',
  'payment-buy-now-pay-later',
  'payment-visa',
  'payment-mastercard',
  'payment-amex',
  'payment-discover',
  'payment-diners',
  'payment-jcb',
  'payment-union-pay',
  'payment-pay-in-person'
] as const

export const VisualAssetRole = Schema.Literals(visualAssetRoles)
export type VisualAssetRole = typeof VisualAssetRole.Type

export const VisualAssetManifestEntry = Schema.Struct({
  id: Schema.String,
  file: Schema.String,
  class: Schema.Literals([
    'font',
    'ui-symbol',
    'illustration',
    'animation',
    'provider-mark'
  ]),
  role: VisualAssetRole,
  owner: Schema.String,
  source: Schema.Struct({
    kind: Schema.Literals([
      'official-provider-kit',
      'upstream-release',
      'internal-dam',
      'commissioned-original'
    ]),
    locator: Schema.String,
    retrievedOn: Schema.String
  }),
  permission: Schema.Struct({
    identifier: Schema.String,
    allowedUse: Schema.String,
    modificationConstraints: Schema.String,
    requiredNotice: Schema.String,
    noticeFile: Schema.optional(Schema.String)
  }),
  integrity: Schema.Struct({ original: Schema.String, derived: Schema.String }),
  transformationRecipe: Schema.String,
  reviewer: Schema.String,
  replacementTrigger: Schema.String,
  observableContract: Schema.Struct({
    geometry: Schema.String,
    crop: Schema.String,
    color: Schema.String,
    timing: Schema.String
  }),
  provider: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      approvedRoles: Schema.Array(VisualAssetRole),
      reviewExpiresOn: Schema.String
    })
  )
})
export type VisualAssetManifestEntry = typeof VisualAssetManifestEntry.Type

export const ShippingVisualAsset = Schema.Struct({
  file: Schema.String,
  integrity: Schema.String
})
export type ShippingVisualAsset = typeof ShippingVisualAsset.Type

export class VisualAssetPolicyViolation extends Schema.TaggedErrorClass<VisualAssetPolicyViolation>()(
  'VisualAssetPolicyViolation',
  { message: Schema.String }
) {}

const prohibitedLegacyHashes = new Set([
  'sha256:a7c90c89240c134f7fdd33d40c000ec90b79d675ea53e8cc5a6d423c073de412',
  'sha256:93c70675bf7a740fb2b357e085c31de4e1adcf2b6a636135aad9cf1d65d93b53',
  'sha256:3231b77ee2775dadbaa76de85f95763976aff1091f63a67fa553d727a6edb933',
  'sha256:7b0041c48ba67087fcf5f6e8ec8d24e95db06cae9bf78c45b4542984bcb7208c'
])

const sha256Pattern = /^sha256:[a-f0-9]{64}$/
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/
const violation = (message: string) => new VisualAssetPolicyViolation({ message })
const isCalendarDate = (value: string) => {
  if (!calendarDatePattern.test(value)) return false
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

const validateManifestEntry = (
  entry: VisualAssetManifestEntry,
  today: string
): VisualAssetPolicyViolation[] => {
  const errors: VisualAssetPolicyViolation[] = []
  if (
    !sha256Pattern.test(entry.integrity.original) ||
    !sha256Pattern.test(entry.integrity.derived)
  ) {
    errors.push(violation(`Invalid SHA-256 identity: ${entry.id}`))
  }
  if (prohibitedLegacyHashes.has(entry.integrity.original)) {
    errors.push(
      violation(`Manifest references a prohibited legacy original: ${entry.id}`)
    )
  }
  if (prohibitedLegacyHashes.has(entry.integrity.derived)) {
    errors.push(violation(`Manifest references a prohibited legacy hash: ${entry.id}`))
  }

  const requiredText = [
    entry.owner,
    entry.source.locator,
    entry.source.retrievedOn,
    entry.permission.identifier,
    entry.permission.allowedUse,
    entry.permission.modificationConstraints,
    entry.transformationRecipe,
    entry.reviewer,
    entry.replacementTrigger,
    entry.observableContract.geometry,
    entry.observableContract.crop,
    entry.observableContract.color,
    entry.observableContract.timing
  ]
  if (requiredText.some((value) => value.trim().length === 0)) {
    errors.push(violation(`Incomplete provenance or observable contract: ${entry.id}`))
  }
  if (!isCalendarDate(entry.source.retrievedOn)) {
    errors.push(violation(`Invalid provenance retrieval date: ${entry.id}`))
  }

  if (entry.class === 'provider-mark') {
    if (entry.source.kind !== 'official-provider-kit') {
      errors.push(
        violation(`Provider mark is not from an official provider kit: ${entry.id}`)
      )
    }
    if (!entry.provider) {
      errors.push(violation(`Provider mark has no provider approval: ${entry.id}`))
    } else {
      if (!isCalendarDate(entry.provider.reviewExpiresOn)) {
        errors.push(violation(`Invalid provider review date: ${entry.id}`))
      }
      if (!entry.provider.approvedRoles.includes(entry.role)) {
        errors.push(
          violation(`Provider mark is not approved for role ${entry.role}: ${entry.id}`)
        )
      }
      if (entry.provider.reviewExpiresOn < today) {
        errors.push(violation(`Provider review expired: ${entry.id}`))
      }
    }
  } else if (entry.provider) {
    errors.push(
      violation(`Non-provider visual declares provider approval: ${entry.id}`)
    )
  }
  return errors
}

export const validateVisualAssetManifest = (input: {
  readonly entries: readonly VisualAssetManifestEntry[]
  readonly shippingAssets: readonly ShippingVisualAsset[]
  readonly today: string
}): VisualAssetPolicyViolation[] => {
  const errors: VisualAssetPolicyViolation[] = []
  const entriesByFile = new Map(input.entries.map((entry) => [entry.file, entry]))
  const assetsByFile = new Map(input.shippingAssets.map((asset) => [asset.file, asset]))
  const seenIds = new Set<string>()

  for (const asset of input.shippingAssets) {
    if (prohibitedLegacyHashes.has(asset.integrity)) {
      errors.push(violation(`Prohibited legacy visual hash: ${asset.file}`))
    }
    if (!entriesByFile.has(asset.file)) {
      errors.push(violation(`Unmanifested shipping visual: ${asset.file}`))
    }
  }

  for (const entry of input.entries) {
    if (seenIds.has(entry.id)) {
      errors.push(violation(`Duplicate visual asset id: ${entry.id}`))
    }
    seenIds.add(entry.id)

    const asset = assetsByFile.get(entry.file)
    if (!asset) {
      errors.push(
        violation(`Manifest visual is missing from shipping assets: ${entry.file}`)
      )
    } else if (asset.integrity !== entry.integrity.derived) {
      errors.push(violation(`Derived integrity mismatch: ${entry.file}`))
    }

    errors.push(...validateManifestEntry(entry, input.today))
  }

  return errors.sort((left, right) => left.message.localeCompare(right.message))
}

type VisualAssetResolution =
  | {
      readonly kind: 'local-manifest-asset'
      readonly role: VisualAssetRole
      readonly assetId: string
      readonly file: string
      readonly integrity: string
    }
  | {
      readonly kind: 'code-native'
      readonly role: VisualAssetRole
      readonly name: string
    }
  | {
      readonly kind: 'native-control'
      readonly role: VisualAssetRole
      readonly inputType: 'password'
    }
  | {
      readonly kind: 'text'
      readonly role: VisualAssetRole
      readonly label: string
    }

const fallbackByRole: Record<
  VisualAssetRole,
  Exclude<VisualAssetResolution, { kind: 'local-manifest-asset' }>
> = {
  'navigation-back': {
    kind: 'code-native',
    role: 'navigation-back',
    name: 'arrow-left'
  },
  'navigation-menu': { kind: 'code-native', role: 'navigation-menu', name: 'menu' },
  'location-nearby': {
    kind: 'code-native',
    role: 'location-nearby',
    name: 'map-pin'
  },
  'location-search': {
    kind: 'code-native',
    role: 'location-search',
    name: 'search'
  },
  'booking-shop': { kind: 'code-native', role: 'booking-shop', name: 'store' },
  dismiss: { kind: 'code-native', role: 'dismiss', name: 'x' },
  'selection-check': { kind: 'code-native', role: 'selection-check', name: 'check' },
  'calendar-scheduling': {
    kind: 'code-native',
    role: 'calendar-scheduling',
    name: 'calendar-days'
  },
  'service-category': {
    kind: 'code-native',
    role: 'service-category',
    name: 'scissors'
  },
  'booking-party': { kind: 'code-native', role: 'booking-party', name: 'users-round' },
  'typography-body': {
    kind: 'text',
    role: 'typography-body',
    label: 'System sans-serif fallback'
  },
  'typography-mono': {
    kind: 'text',
    role: 'typography-mono',
    label: 'System monospace fallback'
  },
  'password-mask': {
    kind: 'native-control',
    role: 'password-mask',
    inputType: 'password'
  },
  'walk-in-illustration': {
    kind: 'code-native',
    role: 'walk-in-illustration',
    name: 'walk-in-status-composition'
  },
  'group-appointment-motion': {
    kind: 'code-native',
    role: 'group-appointment-motion',
    name: 'group-appointment-motion'
  },
  'identity-apple': {
    kind: 'text',
    role: 'identity-apple',
    label: 'Continue with Apple'
  },
  'identity-google': {
    kind: 'text',
    role: 'identity-google',
    label: 'Continue with Google'
  },
  'calendar-google': {
    kind: 'text',
    role: 'calendar-google',
    label: 'Add to calendar'
  },
  'calendar-yahoo': { kind: 'text', role: 'calendar-yahoo', label: 'Add to calendar' },
  'payment-card-generic': {
    kind: 'code-native',
    role: 'payment-card-generic',
    name: 'credit-card'
  },
  'payment-apple-pay': {
    kind: 'text',
    role: 'payment-apple-pay',
    label: 'Pay by card'
  },
  'payment-google-pay': {
    kind: 'text',
    role: 'payment-google-pay',
    label: 'Pay by card'
  },
  'payment-cash-app': { kind: 'text', role: 'payment-cash-app', label: 'Pay by card' },
  'payment-buy-now-pay-later': {
    kind: 'text',
    role: 'payment-buy-now-pay-later',
    label: 'Pay over time'
  },
  'payment-visa': { kind: 'text', role: 'payment-visa', label: 'Card accepted' },
  'payment-mastercard': {
    kind: 'text',
    role: 'payment-mastercard',
    label: 'Card accepted'
  },
  'payment-amex': { kind: 'text', role: 'payment-amex', label: 'Card accepted' },
  'payment-discover': {
    kind: 'text',
    role: 'payment-discover',
    label: 'Card accepted'
  },
  'payment-diners': { kind: 'text', role: 'payment-diners', label: 'Card accepted' },
  'payment-jcb': { kind: 'text', role: 'payment-jcb', label: 'Card accepted' },
  'payment-union-pay': {
    kind: 'text',
    role: 'payment-union-pay',
    label: 'Card accepted'
  },
  'payment-pay-in-person': {
    kind: 'code-native',
    role: 'payment-pay-in-person',
    name: 'store'
  }
}

export const resolveVisualAsset = (input: {
  readonly role: VisualAssetRole
  readonly enabledProviders: readonly string[]
  readonly entries: readonly VisualAssetManifestEntry[]
  readonly today: string
}): VisualAssetResolution => {
  const entry = input.entries.find((candidate) => {
    if (
      candidate.role !== input.role ||
      validateManifestEntry(candidate, input.today).length > 0
    ) {
      return false
    }
    if (!candidate.provider) return candidate.class !== 'provider-mark'
    return (
      candidate.class === 'provider-mark' &&
      candidate.source.kind === 'official-provider-kit' &&
      input.enabledProviders.includes(candidate.provider.id) &&
      candidate.provider.approvedRoles.includes(input.role)
    )
  })

  if (!entry) return fallbackByRole[input.role]
  return {
    kind: 'local-manifest-asset',
    role: input.role,
    assetId: entry.id,
    file: entry.file,
    integrity: entry.integrity.derived
  }
}

export const generateVisualAssetNotices = (
  entries: readonly VisualAssetManifestEntry[]
): string => {
  const thirdParty = entries
    .filter((entry) => entry.permission.requiredNotice.trim().length > 0)
    .sort((left, right) => left.id.localeCompare(right.id))
  const uniqueNotices = new Map(
    thirdParty.map((entry) => [
      [entry.owner, entry.permission.identifier, entry.permission.requiredNotice].join(
        '\n'
      ),
      entry
    ])
  )
  const sections = [...uniqueNotices.values()].map(
    (entry) =>
      `## ${entry.permission.identifier}\n\nOwner: ${entry.owner}\n\n${entry.permission.requiredNotice}${entry.permission.noticeFile ? `\n\nFull license text: \`${entry.permission.noticeFile}\`.` : ''}`
  )
  const body =
    sections.length > 0
      ? sections.join('\n\n')
      : 'No third-party visual binaries are currently shipped by Booking.'

  return `# Third-party visual asset notices\n\nThis file is generated from the Booking visual asset manifest. Do not edit it by hand.\n\n${body}\n`
}
