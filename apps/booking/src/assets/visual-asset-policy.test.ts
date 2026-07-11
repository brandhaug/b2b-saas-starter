import { describe, expect, it } from 'vitest'
import { createContentStore } from '../parity/harness/content-store.ts'
import { createNetworkPolicy } from '../parity/harness/network-policy.ts'
import {
  generateVisualAssetNotices,
  resolveVisualAsset,
  validateVisualAssetManifest as validateManifestViolations,
  type ShippingVisualAsset,
  type VisualAssetManifestEntry
} from './visual-asset-policy.ts'

const hash = (character: string) => `sha256:${character.repeat(64)}`
const validateVisualAssetManifest = (
  input: Parameters<typeof validateManifestViolations>[0]
) => validateManifestViolations(input).map((error) => error.message)

const googlePayMark: VisualAssetManifestEntry = {
  id: 'google-pay-mark',
  file: 'src/assets/shipping/google-pay.svg',
  class: 'provider-mark',
  role: 'payment-google-pay',
  owner: 'Google LLC',
  source: {
    kind: 'official-provider-kit',
    locator: 'https://developers.google.com/pay/api/web/guides/brand-guidelines',
    retrievedOn: '2026-07-11'
  },
  permission: {
    identifier: 'Google Pay API brand guidelines',
    allowedUse: 'Identify an enabled Google Pay payment option',
    modificationConstraints: 'Official proportions and colors only',
    requiredNotice: 'Google Pay is a trademark of Google LLC.'
  },
  integrity: {
    original: hash('a'),
    derived: hash('a')
  },
  transformationRecipe: 'None; official SVG is shipped byte-for-byte.',
  reviewer: 'product-brand-review',
  replacementTrigger: 'Provider kit update or Google Pay integration removal',
  observableContract: {
    geometry: '3:1 horizontal payment mark',
    crop: 'contain with official clear space',
    color: 'official provider colors',
    timing: 'static'
  },
  provider: {
    id: 'google-pay',
    approvedRoles: ['payment-google-pay'],
    reviewExpiresOn: '2027-07-11'
  }
}

const shippingAsset: ShippingVisualAsset = {
  file: googlePayMark.file,
  integrity: googlePayMark.integrity.derived
}

const { provider: _provider, ...nonProviderAsset } = googlePayMark
const walkInIllustration: VisualAssetManifestEntry = {
  ...nonProviderAsset,
  id: 'walk-in-illustration',
  file: 'src/assets/shipping/walk-in.svg',
  class: 'illustration',
  role: 'walk-in-illustration',
  owner: 'Booking product team',
  source: {
    kind: 'commissioned-original',
    locator: 'internal-dam:booking/walk-in-v1',
    retrievedOn: '2026-07-11'
  },
  permission: {
    identifier: 'Employee work-product ownership record',
    allowedUse: 'Booking walk-in empty state',
    modificationConstraints: 'Product-owned adaptations permitted',
    requiredNotice: ''
  },
  integrity: { original: hash('b'), derived: hash('c') }
}

describe('visual asset manifest gate', () => {
  it('rejects unmanifested files and known prohibited legacy hashes', () => {
    const errors = validateVisualAssetManifest({
      entries: [],
      shippingAssets: [
        shippingAsset,
        {
          file: 'src/assets/shipping/legacy-sf-pro.woff2',
          integrity:
            'sha256:93c70675bf7a740fb2b357e085c31de4e1adcf2b6a636135aad9cf1d65d93b53'
        }
      ],
      today: '2026-07-11'
    })

    expect(errors).toContain(
      'Unmanifested shipping visual: src/assets/shipping/google-pay.svg'
    )
    expect(errors).toContain(
      'Prohibited legacy visual hash: src/assets/shipping/legacy-sf-pro.woff2'
    )
  })

  it('rejects a prohibited legacy original even when transformed bytes differ', () => {
    const entry: VisualAssetManifestEntry = {
      ...walkInIllustration,
      integrity: {
        original:
          'sha256:3231b77ee2775dadbaa76de85f95763976aff1091f63a67fa553d727a6edb933',
        derived: hash('c')
      }
    }

    expect(
      validateVisualAssetManifest({
        entries: [entry],
        shippingAssets: [{ file: entry.file, integrity: entry.integrity.derived }],
        today: '2026-07-11'
      })
    ).toContain(
      'Manifest references a prohibited legacy original: walk-in-illustration'
    )
  })

  it('accepts a current official provider mark with observable parity metadata', () => {
    expect(
      validateVisualAssetManifest({
        entries: [googlePayMark],
        shippingAssets: [shippingAsset],
        today: '2026-07-11'
      })
    ).toEqual([])
  })

  it('rejects provider marks whose approval expired or does not cover their role', () => {
    const wrongRole: VisualAssetManifestEntry = {
      ...googlePayMark,
      provider: { ...googlePayMark.provider!, approvedRoles: ['calendar-google'] }
    }

    expect(
      validateVisualAssetManifest({
        entries: [wrongRole],
        shippingAssets: [shippingAsset],
        today: '2027-07-12'
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/not approved for role payment-google-pay/i),
        expect.stringMatching(/provider review expired/i)
      ])
    )
  })

  it('rejects malformed provenance and provider review dates', () => {
    const malformed: VisualAssetManifestEntry = {
      ...googlePayMark,
      source: { ...googlePayMark.source, retrievedOn: '2026-99-99' },
      provider: { ...googlePayMark.provider!, reviewExpiresOn: '2027-02-30' }
    }

    expect(
      validateVisualAssetManifest({
        entries: [malformed],
        shippingAssets: [shippingAsset],
        today: '2026-07-11'
      })
    ).toEqual(
      expect.arrayContaining([
        'Invalid provenance retrieval date: google-pay-mark',
        'Invalid provider review date: google-pay-mark'
      ])
    )
  })
})

describe('customer-visible asset role resolution', () => {
  it('uses deterministic code-native fallbacks unless the matching provider is enabled', () => {
    expect(
      resolveVisualAsset({
        role: 'payment-google-pay',
        enabledProviders: [],
        entries: [googlePayMark],
        today: '2026-07-11'
      })
    ).toEqual({
      kind: 'text',
      label: 'Pay by card',
      role: 'payment-google-pay'
    })

    expect(
      resolveVisualAsset({
        role: 'payment-google-pay',
        enabledProviders: ['google-pay'],
        entries: [googlePayMark],
        today: '2026-07-11'
      })
    ).toEqual({
      kind: 'local-manifest-asset',
      assetId: 'google-pay-mark',
      file: googlePayMark.file,
      integrity: hash('a'),
      role: 'payment-google-pay'
    })

    expect(
      resolveVisualAsset({
        role: 'payment-google-pay',
        enabledProviders: ['google-pay'],
        entries: [
          {
            ...googlePayMark,
            source: { ...googlePayMark.source, kind: 'internal-dam' }
          }
        ],
        today: '2026-07-11'
      })
    ).toEqual({
      kind: 'text',
      label: 'Pay by card',
      role: 'payment-google-pay'
    })

    expect(
      resolveVisualAsset({
        role: 'payment-google-pay',
        enabledProviders: ['google-pay'],
        entries: [
          {
            ...googlePayMark,
            permission: { ...googlePayMark.permission, allowedUse: '' }
          }
        ],
        today: '2026-07-11'
      })
    ).toEqual({
      kind: 'text',
      label: 'Pay by card',
      role: 'payment-google-pay'
    })
  })

  it('resolves an authorized product-owned replacement by observable role', () => {
    expect(
      resolveVisualAsset({
        role: 'walk-in-illustration',
        enabledProviders: [],
        entries: [walkInIllustration],
        today: '2026-07-11'
      })
    ).toEqual({
      kind: 'local-manifest-asset',
      assetId: 'walk-in-illustration',
      file: walkInIllustration.file,
      integrity: hash('c'),
      role: 'walk-in-illustration'
    })
  })

  it('defines native or product-owned replacements for non-provider legacy roles', () => {
    expect(
      resolveVisualAsset({
        role: 'password-mask',
        enabledProviders: [],
        entries: [],
        today: '2026-07-11'
      })
    ).toMatchObject({ kind: 'native-control', inputType: 'password' })

    expect(
      resolveVisualAsset({
        role: 'group-appointment-motion',
        enabledProviders: [],
        entries: [],
        today: '2026-07-11'
      })
    ).toMatchObject({ kind: 'code-native', name: 'group-appointment-motion' })
  })

  it('serves test assets by local content identity and rejects undeclared origins', async () => {
    const store = createContentStore()
    const integrity = await store.put(new TextEncoder().encode('<svg/>'))
    const policy = createNetworkPolicy({
      allow: [],
      localAssetOrigin: 'http://assets.booking.test'
    })
    const localUrl = `http://assets.booking.test/__parity/assets/${integrity}`

    expect(() => policy.assertAllowed(localUrl)).not.toThrow()
    expect(() =>
      policy.assertAllowed('https://legacy-assets.example/icon.svg')
    ).toThrow(/undeclared network request/i)
    await expect(store.response(integrity, 'image/svg+xml').text()).resolves.toBe(
      '<svg/>'
    )
  })
})

describe('visual asset notices', () => {
  it('generates stable notices from authorized third-party manifest entries', () => {
    expect(generateVisualAssetNotices([googlePayMark])).toContain(
      'Google Pay is a trademark of Google LLC.'
    )
  })
})
