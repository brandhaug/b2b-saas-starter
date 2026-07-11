// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BookingPremiumThemeBoundary,
  validateBookingPremiumPalette
} from './booking-premium-theme.tsx'

afterEach(cleanup)

describe('Booking premium theme boundary', () => {
  it('normalizes the seven controlled palette fields at one boundary', () => {
    const palette = validateBookingPremiumPalette({
      primaryColor: '0x0083ff',
      primaryDark: '#11551b',
      primaryDarker: '#044107',
      primaryLight: '#1a721f',
      primaryFontColor: '#000000',
      secondaryColor: '#ffffff',
      linkColor: '#006bd0'
    })
    expect(palette).toEqual({
      primaryColor: '#0083ff',
      primaryDark: '#11551b',
      primaryDarker: '#044107',
      primaryLight: '#1a721f',
      primaryFontColor: '#000000',
      secondaryColor: '#ffffff',
      linkColor: '#006bd0'
    })

    render(
      <BookingPremiumThemeBoundary palette={palette}>
        <p>Premium booking</p>
      </BookingPremiumThemeBoundary>
    )
    const boundary = screen.getByText('Premium booking').parentElement
    expect(boundary?.dataset.premium).toBe('true')
    expect(boundary?.getAttribute('style')).toContain('#0083ff')
  })

  it('rejects arbitrary CSS and incomplete palette overrides', () => {
    expect(
      validateBookingPremiumPalette({
        primaryColor: 'url(https://example.test/tracker)',
        primaryDark: '#11551b'
      })
    ).toBeNull()
  })
})
