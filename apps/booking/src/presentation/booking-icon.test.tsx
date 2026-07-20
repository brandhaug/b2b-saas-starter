// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BookingIcon } from './booking-icon.tsx'

describe('BookingIcon', () => {
  it('renders the code-native booking symbols used by presentation flows', () => {
    const { container } = render(
      <>
        <BookingIcon iconRole="popup-close" aria-label="Close" />
        <BookingIcon iconRole="policy-cancellation" aria-label="Cancellation policy" />
        <BookingIcon iconRole="policy-status-check" aria-label="Complete" />
      </>
    )

    const close = screen.getByLabelText('Close')
    const cancellation = screen.getByLabelText('Cancellation policy')
    const complete = screen.getByLabelText('Complete')
    expect(close.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(cancellation.getAttribute('viewBox')).toBe('0 0 81 80')
    expect(complete.getAttribute('viewBox')).toBe('0 0 11 8')
    expect(container.querySelectorAll('svg')).toHaveLength(3)
  })
})
