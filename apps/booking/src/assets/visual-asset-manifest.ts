import type {
  VisualAssetManifestEntry,
  VisualAssetRole
} from './visual-asset-policy.ts'

const geistFont = (
  family: 'geist' | 'geist-mono',
  file: string,
  integrity: `sha256:${string}`,
  role: VisualAssetRole
): VisualAssetManifestEntry => ({
  id: file.replace(/\.woff2$/, ''),
  file: `node_modules/@fontsource-variable/${family}/files/${file}`,
  class: 'font',
  role,
  owner: 'The Geist Project Authors',
  source: {
    kind: 'upstream-release',
    locator: `https://www.npmjs.com/package/@fontsource-variable/${family}`,
    retrievedOn: '2026-07-11'
  },
  permission: {
    identifier: 'SIL Open Font License 1.1',
    allowedUse: 'Bundle and embed the unmodified font with Booking',
    modificationConstraints: 'OFL 1.1 terms and reserved-name rules apply',
    requiredNotice:
      'Copyright 2024 The Geist Project Authors. Licensed under the SIL Open Font License, Version 1.1. Full license: https://openfontlicense.org/open-font-license-official-text/',
    noticeFile: 'licenses/OFL-1.1.txt'
  },
  integrity: { original: integrity, derived: integrity },
  transformationRecipe:
    'Unmodified WOFF2 from the pinned @fontsource-variable package.',
  reviewer: 'booking-asset-policy-review',
  replacementTrigger: 'Pinned package, upstream license, or Booking typography change',
  observableContract: {
    geometry: 'Geist variable-font metrics at weights 100 through 900',
    crop: 'Unicode-range subset selected by the browser',
    color: 'Inherits current text color',
    timing: 'font-display swap'
  }
})

export const visualAssetManifest = [
  geistFont(
    'geist',
    'geist-cyrillic-ext-wght-normal.woff2',
    'sha256:2317fa4bb293c9c0b110e18315d529235c47a0ddd3338cea3d8c7955e927899e',
    'typography-body'
  ),
  geistFont(
    'geist',
    'geist-cyrillic-wght-normal.woff2',
    'sha256:6894439694946a589d157ece003086960a6a4013d74a813dab7602efdb3d8c09',
    'typography-body'
  ),
  geistFont(
    'geist',
    'geist-vietnamese-wght-normal.woff2',
    'sha256:8fa40e5d248247735eb97a0bd593b8852440430600d6ba01364c31fe0abc1fe1',
    'typography-body'
  ),
  geistFont(
    'geist',
    'geist-latin-ext-wght-normal.woff2',
    'sha256:824f485b5d26e2f2da3c2b236132ece1bc8e4e43373452950bb0e40548b4313f',
    'typography-body'
  ),
  geistFont(
    'geist',
    'geist-latin-wght-normal.woff2',
    'sha256:19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1',
    'typography-body'
  ),
  geistFont(
    'geist-mono',
    'geist-mono-cyrillic-ext-wght-normal.woff2',
    'sha256:bd1b9caace920419e40805d118eb5df340651ccf60f324a6c0fc969184c5a9ac',
    'typography-mono'
  ),
  geistFont(
    'geist-mono',
    'geist-mono-cyrillic-wght-normal.woff2',
    'sha256:856e341d017239201ffa3eda7a1e9768dcd145dd9a6e82e24d87068c49c4f587',
    'typography-mono'
  ),
  geistFont(
    'geist-mono',
    'geist-mono-symbols2-wght-normal.woff2',
    'sha256:5aaf17e01d441991470749b33a92a5492f6c8697f6e7e0f11298b23f3652374a',
    'typography-mono'
  ),
  geistFont(
    'geist-mono',
    'geist-mono-vietnamese-wght-normal.woff2',
    'sha256:be2d997590216caf1e91c214a90cef7cf9863a3134c9d9666ee53d3fc3982474',
    'typography-mono'
  ),
  geistFont(
    'geist-mono',
    'geist-mono-latin-ext-wght-normal.woff2',
    'sha256:63e27dba1a5baa700f1e279593c25ea6cfe24d2dff5badd2ecba178a35a49bb9',
    'typography-mono'
  ),
  geistFont(
    'geist-mono',
    'geist-mono-latin-wght-normal.woff2',
    'sha256:af61b969e7f999969f6af576e584ee85dca301a008a76be1251d172d56b9904c',
    'typography-mono'
  )
] as const satisfies readonly VisualAssetManifestEntry[]
