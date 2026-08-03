// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookingParty } from '@b2b-saas-starter/capabilities/booking'
import { BookingPartyFlow } from './booking-party-flow.tsx'

afterEach(cleanup)

const party: BookingParty = {
  id: 'bpt_group',
  bookingSessionId: 'bsn_group',
  shopId: 'shp_one',
  lifecycle: 'active',
  currency: 'RON',
  locale: 'en',
  version: 3,
  requests: [
    {
      id: 'brq_one',
      bookingPartyId: 'bpt_group',
      position: 0,
      providerPreference: 'specific',
      providerId: 'prv_one',
      primaryServiceId: 'svc_one',
      serviceIds: ['svc_one'],
      holdId: 'hld_one',
      holdExpiresAt: '2026-07-13T10:00:00.000Z',
      customerAccountId: null,
      customerDetails: { name: 'Ana', email: 'ana@example.com', phone: null },
      startsAt: '2026-07-13T09:00:00.000Z',
      endsAt: '2026-07-13T09:30:00.000Z'
    },
    {
      id: 'brq_two',
      bookingPartyId: 'bpt_group',
      position: 1,
      providerPreference: null,
      providerId: null,
      primaryServiceId: null,
      serviceIds: [],
      holdId: null,
      customerAccountId: null,
      customerDetails: null,
      startsAt: null,
      endsAt: null
    }
  ]
}
const messages = {
  title: 'Your group',
  addGuest: 'Add guest',
  removeGuest: 'Remove guest',
  moveEarlier: 'Move earlier',
  moveLater: 'Move later',
  guest: (position: number) => `Guest ${position}`,
  incomplete: 'Incomplete',
  complete: 'Complete'
}

describe('Booking Party flow', () => {
  it('switches and reorders requests with accessible ordered controls', () => {
    const onSwitch = vi.fn()
    const onMove = vi.fn()
    render(
      <BookingPartyFlow
        party={party}
        activeRequestId="brq_one"
        busy={false}
        now="2026-07-12T10:00:00.000Z"
        messages={messages}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onMove={onMove}
        onSwitch={onSwitch}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Ana' }).getAttribute('aria-current')
    ).toBe('step')
    fireEvent.click(screen.getByRole('button', { name: 'Guest 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move earlier: Guest 2' }))
    expect(onSwitch).toHaveBeenCalledWith('brq_two')
    expect(onMove).toHaveBeenCalledWith('brq_two', 'earlier')
  })

  it('keeps the final request and exposes completeness without color alone', () => {
    const onRemove = vi.fn()
    render(
      <BookingPartyFlow
        party={{ ...party, requests: [party.requests[0]!] }}
        activeRequestId="brq_one"
        busy={false}
        now="2026-07-12T10:00:00.000Z"
        messages={messages}
        onAdd={vi.fn()}
        onRemove={onRemove}
        onMove={vi.fn()}
        onSwitch={vi.fn()}
      />
    )
    expect(screen.getByText('Complete')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Remove guest: Ana' }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it('keeps every party action available at a narrow reduced-motion viewport', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })
    })
    render(
      <BookingPartyFlow
        party={party}
        activeRequestId="brq_two"
        busy={false}
        now="2026-07-12T10:00:00.000Z"
        messages={messages}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onMove={vi.fn()}
        onSwitch={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Add guest' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove guest: Guest 2' })).toBeTruthy()
  })
})
