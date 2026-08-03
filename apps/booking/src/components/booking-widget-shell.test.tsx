// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BookingPremiumThemeBoundary } from '../presentation/booking-premium-theme.tsx'
import {
  BookingLegacyProcessingOverlay,
  BookingShellProvider,
  BookingWidgetShell
} from './booking-widget-shell.tsx'

afterEach(cleanup)

describe('Booking widget shell', () => {
  it('owns embedding, premium theme, and busy feedback on one shell element', () => {
    const { container } = render(
      <BookingShellProvider embedding="widget">
        <BookingPremiumThemeBoundary
          palette={{
            primaryColor: '#111111',
            primaryDark: '#222222',
            primaryDarker: '#333333',
            primaryLight: '#444444',
            primaryFontColor: '#555555',
            secondaryColor: '#666666',
            linkColor: '#777777'
          }}
        >
          <BookingWidgetShell busy busyLabel="Updating booking…">
            <p>Booking view</p>
          </BookingWidgetShell>
        </BookingPremiumThemeBoundary>
      </BookingShellProvider>
    )

    const shell = container.firstElementChild
    expect(container.childElementCount).toBe(1)
    expect(shell?.getAttribute('data-booking-shell')).toBe('canonical')
    expect(shell?.getAttribute('data-embedding')).toBe('widget')
    expect(shell?.getAttribute('data-scroll-owner')).toBe('content')
    expect(shell?.getAttribute('style')).toContain('#111111')
    expect(shell?.hasAttribute('aria-busy')).toBe(false)
    expect(screen.getByText('Updating booking…')).toBeTruthy()
  })

  it('replaces the pending spinner with the legacy success message', async () => {
    const { rerender } = render(
      <BookingLegacyProcessingOverlay
        state="pending"
        pendingLabel="Processing"
        successLabel="Success"
      />
    )

    const pending = screen.getByText('Processing')
    expect(
      pending.parentElement?.previousElementSibling?.querySelector('svg')
    ).toBeTruthy()

    rerender(
      <BookingLegacyProcessingOverlay
        state="success"
        pendingLabel="Processing"
        successLabel="Success"
      />
    )

    expect(screen.queryByText('Processing')).toBeNull()
    const success = screen.getByTestId('text:successMessage')
    expect(success.textContent).toBe('Success')
    expect(
      success.parentElement?.previousElementSibling?.querySelector('svg')
    ).toBeTruthy()
  })
})
