// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  beginMobileSheetUnderlayDrag,
  finishMobileSheetUnderlayDrag,
  updateMobileSheetUnderlayDrag
} from './mobile-sheet-underlay.ts'

describe('mobile sheet underlay rendering', () => {
  afterEach(() => {
    finishMobileSheetUnderlayDrag()
    document.documentElement.style.removeProperty('--safe-area-inset-top')
    document.body.style.removeProperty('background-color')
    document.body.innerHTML = ''
  })

  it('dims the exposed canvas with opacity without repainting the body background', () => {
    document.body.innerHTML =
      '<main data-merchant-home-layer="true" class="merchant-home-layer"></main>'
    document.body.style.backgroundColor = 'rgb(224, 242, 254)'

    beginMobileSheetUnderlayDrag()
    updateMobileSheetUnderlayDrag(500, 1_000)

    expect(document.body.style.backgroundColor).toBe('rgb(224, 242, 254)')
    expect(
      Number(
        document.body.style.getPropertyValue(
          '--merchant-mobile-sheet-outside-dim-opacity'
        )
      )
    ).toBeCloseTo(0.6)

    finishMobileSheetUnderlayDrag()

    expect(
      document.body.style.getPropertyValue(
        '--merchant-mobile-sheet-outside-dim-opacity'
      )
    ).toBe('')
  })
})
