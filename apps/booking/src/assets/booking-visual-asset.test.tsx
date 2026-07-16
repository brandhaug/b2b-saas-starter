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
        <BookingVisualAsset assetRole="popup-close" aria-label="Close" />
        <BookingVisualAsset
          assetRole="policy-cancellation"
          aria-label="Cancellation policy"
        />
        <BookingVisualAsset assetRole="policy-status-check" aria-label="Complete" />
      </>
    )

    const walkIn = screen.getByLabelText('Walk in')
    const group = screen.getByLabelText('Group appointment')
    const close = screen.getByLabelText('Close')
    const cancellation = screen.getByLabelText('Cancellation policy')
    const complete = screen.getByLabelText('Complete')
    expect(walkIn.tagName).toBe('svg')
    expect(walkIn.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(walkIn.getAttribute('stroke')).toBe('currentColor')
    expect(group.tagName).toBe('svg')
    expect(close.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(cancellation.getAttribute('viewBox')).toBe('0 0 81 80')
    expect(complete.getAttribute('viewBox')).toBe('0 0 11 8')
    expect(container.querySelector('.booking-group-appointment-motion')).toBeTruthy()
    expect(motionCss).toContain('300ms ease-out')
    expect(motionCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(motionCss).toContain('animation: none')
  })
})
