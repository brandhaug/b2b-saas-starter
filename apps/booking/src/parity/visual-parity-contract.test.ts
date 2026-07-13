import { describe, expect, it } from 'vitest'
import { smokeScenarios } from './harness/smoke-scenarios.ts'
import {
  requiredVisualEvidenceCells,
  visualParityLocales,
  visualParityMotion,
  visualParityProfiles
} from './visual-parity-contract.ts'

describe('visual parity contract', () => {
  it('freezes the accepted viewport, embedding, input, zoom, and motion profiles', () => {
    expect(Object.keys(visualParityProfiles)).toEqual([
      'mobile-narrow-375x812',
      'mobile-wide-376x812',
      'tablet-widget-768x900-iframe-375x700',
      'laptop-1024x768',
      'desktop-1440x900',
      'zoom-200'
    ])
    expect(visualParityProfiles['desktop-1440x900'].content.width).toBe(375)
    expect(visualParityProfiles['zoom-200'].zoom).toBe(2)
    expect(visualParityMotion).toMatchObject({ interactionMs: 150, pageMs: 300 })
  })

  it('requires every supported locale at every visual profile', () => {
    expect(visualParityLocales).toEqual(['en', 'es', 'fr', 'ro'])
    expect(requiredVisualEvidenceCells).toHaveLength(9)
    for (const { locale, profile } of requiredVisualEvidenceCells) {
      const expected = visualParityProfiles[profile]
      expect(
        smokeScenarios.some(
          (scenario) =>
            scenario.journey === 'shell-boundary' &&
            scenario.locale === locale &&
            scenario.viewport.width === expected.host.width &&
            scenario.viewport.height === expected.host.height
        )
      ).toBe(true)
    }
  })

  it('keeps screenshot tolerances explicit and element-scoped', () => {
    for (const scenario of smokeScenarios) {
      if (scenario.visual.mode === 'exact') expect(scenario.visual.masks).toEqual([])
      else
        expect(
          scenario.visual.masks.every(
            ({ selector, renderer, reason }) => selector && renderer && reason
          )
        ).toBe(true)
    }
  })
})
