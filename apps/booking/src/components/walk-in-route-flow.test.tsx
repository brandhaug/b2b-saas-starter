// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../presentation/booking-primitives.tsx', () => ({
  BookingViewport: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BookingStack: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BookingSurface: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  BookingText: ({ children }: { children: ReactNode }) => <h1>{children}</h1>
}))
import { WalkInRouteFlow } from './walk-in-route-flow.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const overview = {
  state: 'open',
  services: [{ id: 'svc_cut', name: 'Signature cut' }],
  providers: [{ id: 'prv_ana', name: 'Ana' }],
  queue: []
}

describe('WalkInRouteFlow', () => {
  it('renders real service/provider options and an explicit empty queue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(overview))
    )
    render(
      <WalkInRouteFlow
        pathname="/m/booking/s/walk-ins"
        locale="en"
        acknowledgment={false}
      />
    )
    expect(await screen.findByRole('option', { name: 'Signature cut' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Any professional' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Ana' })).toBeTruthy()
    expect(screen.getByText('No one is waiting right now.')).toBeTruthy()
  })

  it('localizes the closed journey in Romanian', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...overview, state: 'closed' }))
    )
    render(
      <WalkInRouteFlow
        pathname="/m/booking/s/walk-ins"
        locale="ro"
        acknowledgment={false}
      />
    )
    expect(
      await screen.findByRole('heading', { name: 'Programări fără rezervare' })
    ).toBeTruthy()
    expect(screen.getByText('Înscrierile sunt închise momentan.')).toBeTruthy()
  })

  it('renders the protected lifecycle acknowledgment from current queue state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          id: 'wie_one',
          shopId: 'shp_one',
          status: 'serving',
          position: 1,
          projectedWaitMinutes: 0,
          serviceId: 'svc_cut',
          providerPreference: { kind: 'any' },
          locale: 'en',
          history: [
            { from: null, to: 'waiting', occurredAt: '2026-07-12T10:00:00Z' },
            { from: 'waiting', to: 'called', occurredAt: '2026-07-12T10:10:00Z' },
            { from: 'called', to: 'serving', occurredAt: '2026-07-12T10:15:00Z' }
          ]
        })
      )
    )
    render(
      <WalkInRouteFlow
        pathname="/m/booking/s/walk-ins/wie_one"
        locale="en"
        acknowledgment
      />
    )
    expect(await screen.findByText('Serving')).toBeTruthy()
    expect(screen.getByText('Position: 1')).toBeTruthy()
  })

  it.each([
    ['en', 'Walk in today'],
    ['es', 'Atención sin cita'],
    ['fr', 'Venir sans rendez-vous'],
    ['ro', 'Programări fără rezervare']
  ] as const)(
    'renders the complete %s locale at compact and wide viewports',
    async (locale, title) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(overview))
      )
      for (const width of [320, 1280]) {
        Object.defineProperty(window, 'innerWidth', {
          configurable: true,
          value: width
        })
        const view = render(
          <WalkInRouteFlow
            pathname="/m/booking/s/walk-ins"
            locale={locale}
            acknowledgment={false}
          />
        )
        expect(await screen.findByRole('heading', { name: title })).toBeTruthy()
        expect(screen.getByRole('button')).toBeTruthy()
        view.unmount()
      }
    }
  )
})
