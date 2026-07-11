import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectBuiltVisualAssetNotices,
  inspectBuiltVisualAssets,
  inspectVisualAssetSources
} from './check-visual-assets.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  )
})

describe('visual asset repository gate', () => {
  it('finds unmanifested local visuals and bundled font package imports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'booking-visual-assets-'))
    temporaryRoots.push(root)
    await mkdir(join(root, 'src/assets'), { recursive: true })
    await writeFile(join(root, 'src/assets/unknown.svg'), '<svg/>')
    await writeFile(
      join(root, 'src/root.tsx'),
      "import '@fontsource-variable/geist/index.css'\n"
    )

    const errors = await inspectVisualAssetSources({
      root,
      entries: [],
      today: '2026-07-11'
    })

    expect(errors).toEqual(
      expect.arrayContaining([
        'Unmanifested shipping visual: src/assets/unknown.svg',
        expect.stringMatching(/bundled font package import/i)
      ])
    )
  })

  it('rejects duplicate built binaries that share one manifest identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'booking-built-visual-assets-'))
    temporaryRoots.push(root)
    const assets = join(root, 'dist/client/assets')
    await mkdir(assets, { recursive: true })
    await writeFile(join(assets, 'first.svg'), '<svg/>')
    await writeFile(join(assets, 'copy.svg'), '<svg/>')
    const integrity =
      'sha256:d4dc56669143034f31aa309635d4113d9ad76a02b1739da22c965ed2049be9e6'

    const errors = await inspectBuiltVisualAssets({
      root,
      entries: [
        {
          id: 'test-symbol',
          file: 'src/assets/shipping/test.svg',
          class: 'ui-symbol',
          role: 'selection-check',
          owner: 'Test owner',
          source: {
            kind: 'commissioned-original',
            locator: 'internal-dam:test',
            retrievedOn: '2026-07-11'
          },
          permission: {
            identifier: 'Test ownership',
            allowedUse: 'Test',
            modificationConstraints: 'None',
            requiredNotice: ''
          },
          integrity: { original: integrity, derived: integrity },
          transformationRecipe: 'None',
          reviewer: 'test-reviewer',
          replacementTrigger: 'Test changes',
          observableContract: {
            geometry: 'square',
            crop: 'contain',
            color: 'current color',
            timing: 'static'
          }
        }
      ]
    })

    expect(errors).toContain(
      'Manifest identity emitted more than once: test-symbol (2 built files)'
    )
  })

  it('rejects a build that omits generated visual asset notices', async () => {
    const root = await mkdtemp(join(tmpdir(), 'booking-built-notices-'))
    temporaryRoots.push(root)
    await mkdir(join(root, 'dist/client'), { recursive: true })
    await writeFile(join(root, 'THIRD_PARTY_VISUAL_ASSETS.md'), 'notice')

    await expect(
      inspectBuiltVisualAssetNotices({ root, entries: [] })
    ).resolves.toContain(
      'Visual asset notice is missing from built output: THIRD_PARTY_VISUAL_ASSETS.md'
    )
  })
})
