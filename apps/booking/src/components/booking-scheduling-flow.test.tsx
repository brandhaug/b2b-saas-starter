// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookingAvailability } from '@b2b-saas-starter/capabilities'
import { BookingSchedulingFlow } from './booking-scheduling-flow.tsx'

afterEach(cleanup)

const availability: BookingAvailability = {
  timezone: 'UTC',
  slots: [
    {
      startsAt: '2026-07-13T09:00:00.000Z',
      endsAt: '2026-07-13T10:00:00.000Z'
    },
    {
      startsAt: '2026-07-13T10:00:00.000Z',
      endsAt: '2026-07-13T11:00:00.000Z'
    },
    {
      startsAt: '2026-07-14T09:00:00.000Z',
      endsAt: '2026-07-14T10:00:00.000Z'
    },
    {
      startsAt: '2026-07-20T09:00:00.000Z',
      endsAt: '2026-07-20T10:00:00.000Z'
    }
  ],
  hold: null
}

describe('Booking scheduling flow', () => {
  it('keeps the dense calendar strip and three-column time selection feedback', () => {
    const select = vi.fn()
    render(
      <BookingSchedulingFlow
        availability={availability}
        busy={false}
        slotLost={false}
        onSelect={select}
      />
    )
    expect(screen.getByText('July 2026')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /monday, july 13/i }))
    fireEvent.click(screen.getByRole('button', { name: '09:00' }))
    expect(select).toHaveBeenCalledWith('2026-07-13T09:00:00.000Z')
    fireEvent.click(screen.getByRole('button', { name: 'Next dates' }))
    fireEvent.click(screen.getByRole('button', { name: /monday, july 20/i }))
    fireEvent.click(screen.getByRole('button', { name: '09:00' }))
    expect(select).toHaveBeenLastCalledWith('2026-07-20T09:00:00.000Z')
  })

  it('renders no-times and safe slot-lost recovery without hiding saved selections', () => {
    const { rerender } = render(
      <BookingSchedulingFlow
        availability={{ ...availability, slots: [] }}
        busy={false}
        slotLost={false}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('No times in the next 14 days')).toBeTruthy()
    rerender(
      <BookingSchedulingFlow
        availability={availability}
        busy={false}
        slotLost
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('That time was just booked')).toBeTruthy()
    expect(screen.getByText('Your service choices are still saved.')).toBeTruthy()

    rerender(
      <BookingSchedulingFlow
        availability={availability}
        busy={false}
        slotLost={false}
        holdExpired
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('Your held time expired')).toBeTruthy()
  })

  it('keeps a valid frozen hold visible when current Availability has no slots', () => {
    render(
      <BookingSchedulingFlow
        availability={{
          timezone: 'UTC',
          slots: [],
          hold: {
            id: 'hld_one',
            bookingSessionId: 'bsn_one',
            createdAt: '2026-07-10T09:30:00.000Z',
            expiresAt: '2026-07-10T09:40:00.000Z',
            quote: {
              startsAt: '2026-07-13T09:00:00.000Z',
              endsAt: '2026-07-13T10:00:00.000Z',
              providerPreference: { kind: 'any' },
              assignedProvider: { id: 'prv_ava', displayName: 'Ava' },
              services: [
                {
                  id: 'svc_cut',
                  role: 'primary',
                  name: 'Cut',
                  durationMinutes: 60,
                  priceMinor: 5000,
                  currency: 'USD'
                }
              ],
              durationMinutes: 60,
              currency: 'USD',
              totalMinor: 5000
            }
          }
        }}
        busy={false}
        slotLost={false}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('Your time is held')).toBeTruthy()
    expect(screen.getByText(/frozen quote remains held/i)).toBeTruthy()
  })
})
