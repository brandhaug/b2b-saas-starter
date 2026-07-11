// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BookingVisualAsset } from './booking-visual-asset.tsx'

const motionCss = readFileSync(
  resolve(process.cwd(), 'src/assets/booking-visual-asset.css'),
  'utf8'
)

describe('BookingVisualAsset', () => {
  it('renders product-owned code-native illustration and motion fallbacks', () => {
    const { container } = render(
      <>
        <BookingVisualAsset assetRole="walk-in-illustration" aria-label="Walk in" />
        <BookingVisualAsset
          assetRole="group-appointment-motion"
          aria-label="Group appointment"
        />
      </>
    )

    const walkIn = screen.getByLabelText('Walk in')
    const group = screen.getByLabelText('Group appointment')
    expect(walkIn.tagName).toBe('svg')
    expect(walkIn.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(walkIn.getAttribute('stroke')).toBe('currentColor')
    expect(group.tagName).toBe('svg')
    expect(container.querySelector('.booking-group-appointment-motion')).toBeTruthy()
    expect(motionCss).toContain('300ms ease-out')
    expect(motionCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(motionCss).toContain('animation: none')
  })
})
