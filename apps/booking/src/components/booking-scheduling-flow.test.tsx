// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookingAvailability } from '@b2b-saas-starter/capabilities/booking'
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

const hold: NonNullable<BookingAvailability['hold']> = {
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

describe('Booking scheduling flow', () => {
  it('matches the legacy title, calendar line, and three-column timetable contract', async () => {
    const select = vi.fn()
    const back = vi.fn()
    const { container } = render(
      <BookingSchedulingFlow
        availability={availability}
        busy={false}
        slotLost={false}
        onBack={back}
        onSelect={select}
      />
    )
    expect(
      screen.getByText('Choose a time').closest('[data-testid="container:title"]')
        ?.parentElement
    ).toBe(container.firstElementChild)
    expect(container.firstElementChild?.getAttribute('data-booking-shell')).toBe(
      'canonical'
    )
    expect(container.querySelector('[aria-busy]')).toBeNull()
    expect(screen.getByText('July 2026')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next dates' })).toBeNull()
    expect(
      (
        screen.getByRole('button', {
          name: /wednesday, july 15/i
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    fireEvent.click(screen.getByTestId('btn:back'))
    expect(back).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: /monday, july 13/i }))
    fireEvent.click(screen.getByRole('button', { name: /9:00/ }))
    expect(select).toHaveBeenCalledWith('2026-07-13T09:00:00.000Z')
    expect(screen.queryByRole('button', { name: /monday, july 20/i })).toBeNull()
    fireEvent.click(screen.getByTestId('btn:expandCalendar'))
    const monthCalendar = await screen.findByTestId('calendarMonth')
    expect(monthCalendar.getAttribute('data-calendar-contract')).toBe(
      'legacy-calendar-month'
    )
    expect(
      monthCalendar.querySelector(
        '[aria-pressed="true"] [data-calendar-day-border="inner"]'
      )
    ).toBeTruthy()
    expect(
      monthCalendar
        .querySelector('[aria-label="Wednesday, July 15"]')
        ?.getAttribute('data-calendar-day-state')
    ).toBe('day-off')
    expect(
      monthCalendar
        .querySelector('[aria-label="Monday, July 13"]')
        ?.getAttribute('data-calendar-day-state')
    ).toBe('selected')
    expect(
      monthCalendar
        .querySelector('[aria-label="Tuesday, July 14"]')
        ?.getAttribute('data-calendar-day-state')
    ).toBe('available')
    expect(
      Array.from(
        monthCalendar.querySelectorAll('[data-calendar-layer="header"] span')
      ).map((element) => element.textContent)
    ).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S'])
    expect(monthCalendar.querySelector('[aria-label="Sunday, June 28"]')).toBeNull()
    expect(monthCalendar.querySelectorAll('[data-calendar-cell]')).toHaveLength(35)
    fireEvent.click(monthCalendar.querySelector('[aria-label="Monday, July 13"]')!)
    expect(screen.getByTestId('calendarMonth')).toBe(monthCalendar)
    fireEvent.click(monthCalendar.querySelector('[aria-label="Monday, July 20"]')!)
    fireEvent.click(
      await screen.findByTestId('btn:chooseTime:time:2026-07-20T09:00:00.000Z')
    )
    expect(select).toHaveBeenLastCalledWith('2026-07-20T09:00:00.000Z')
  })

  it('keeps month navigation available through the last returned slot', async () => {
    render(
      <BookingSchedulingFlow
        availability={{
          ...availability,
          slots: [
            ...availability.slots,
            {
              startsAt: '2026-08-20T09:00:00.000Z',
              endsAt: '2026-08-20T10:00:00.000Z'
            }
          ]
        }}
        busy={false}
        slotLost={false}
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTestId('btn:expandCalendar'))
    const nextMonth = screen.getByRole('button', { name: 'Next month' })
    expect((nextMonth as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(nextMonth)
    expect(
      await screen.findByRole('button', { name: /thursday, august 20/i })
    ).toBeTruthy()
  })

  it('renders no-times and safe slot-lost recovery without hiding saved selections', () => {
    const { rerender } = render(
      <BookingSchedulingFlow
        availability={{ ...availability, slots: [] }}
        busy={false}
        slotLost={false}
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('No times in the next 14 days')).toBeTruthy()
    rerender(
      <BookingSchedulingFlow
        availability={availability}
        busy={false}
        slotLost
        onBack={vi.fn()}
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
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('Your held time expired')).toBeTruthy()

    rerender(
      <BookingSchedulingFlow
        availability={{ ...availability, slots: [] }}
        busy={false}
        slotLost={false}
        locale="ro"
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('Nu sunt intervale în următoarele 14 zile')).toBeTruthy()
  })

  it('keeps a valid frozen hold visible when current Availability has no slots', () => {
    const release = vi.fn()
    render(
      <BookingSchedulingFlow
        availability={{
          timezone: 'UTC',
          slots: [],
          hold
        }}
        busy={false}
        slotLost={false}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        onRelease={release}
        onCheckout={vi.fn()}
      />
    )
    expect(screen.getByText('Your time is held')).toBeTruthy()
    expect(screen.getByText(/frozen quote remains held/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Choose another time' }))
    expect(release).toHaveBeenCalledOnce()
  })

  it('keeps the selected time visible when fresh Availability omits the held slot', () => {
    render(
      <BookingSchedulingFlow
        availability={{
          ...availability,
          slots: availability.slots.filter(
            (slot) => slot.startsAt !== hold.quote.startsAt
          ),
          hold
        }}
        busy={false}
        slotLost={false}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        onCheckout={vi.fn()}
      />
    )
    expect(
      screen.getByTestId('btn:chooseTime:time:2026-07-13T09:00:00.000Z:selected')
    ).toBeTruthy()
    expect(screen.getByTestId('btn:viewOrder')).toBeTruthy()
  })

  it('offers the legacy next-time card when Today has no availability', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const tomorrowValue = new Date(`${today}T12:00:00.000Z`)
    tomorrowValue.setUTCDate(tomorrowValue.getUTCDate() + 1)
    const tomorrow = tomorrowValue.toISOString().slice(0, 10)
    render(
      <BookingSchedulingFlow
        availability={{
          timezone: 'UTC',
          hold: null,
          slots: [
            {
              startsAt: `${tomorrow}T09:00:00.000Z`,
              endsAt: `${tomorrow}T10:00:00.000Z`
            }
          ]
        }}
        busy={false}
        slotLost={false}
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('btn:expandCalendar'))
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    fireEvent.click(await screen.findByTestId('btn:chooseTime:nextTime'))
    expect((await screen.findByTestId('text:selectedDate')).textContent).toBe(
      new Intl.DateTimeFormat('en', {
        timeZone: 'UTC',
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      }).format(tomorrowValue)
    )
  })
})
