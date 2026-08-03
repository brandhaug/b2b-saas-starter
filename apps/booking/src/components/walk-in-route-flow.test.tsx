// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../presentation/booking-primitives.tsx', () => ({
  BookingViewport: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BookingPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  BookingPageContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BookingStack: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BookingSurface: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  BookingText: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  BookingStatus: ({ children, tone }: { children: ReactNode; tone?: string }) => (
    <div role={tone === 'danger' ? 'alert' : 'status'}>{children}</div>
  ),
  BookingButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  BookingField: ({
    label,
    ...props
  }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
    <label>
      {label}
      <input {...props} />
    </label>
  ),
  BookingSelectField: ({
    label,
    children,
    ...props
  }: {
    label: string
    children: ReactNode
  } & React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <label>
      {label}
      <select {...props}>{children}</select>
    </label>
  )
}))
import { WalkInRouteFlow } from './walk-in-route-flow.tsx'
import { walkInCatalog } from '../localization/booking-localization.ts'

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

  it('preselects the service encoded by the canonical walk-in service route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...overview,
          services: [{ id: 'svc_other', name: 'Other service' }, ...overview.services]
        })
      )
    )
    render(
      <WalkInRouteFlow
        pathname="/m/booking/s/walk-ins"
        locale="en"
        acknowledgment={false}
        initialServiceId="signature-cut"
      />
    )
    expect(
      ((await screen.findByLabelText('Service')) as unknown as HTMLSelectElement).value
    ).toBe('svc_cut')
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
    ['waiting', 'Waiting'],
    ['called', 'Called'],
    ['serving', 'Serving'],
    ['served', 'Served'],
    ['removed', 'Removed'],
    ['expired', 'Expired']
  ] as const)('renders the %s acknowledgment lifecycle', async (status, label) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          id: `wie_${status}`,
          shopId: 'shp_one',
          status,
          position: 1,
          projectedWaitMinutes: 0,
          serviceId: 'svc_cut',
          providerPreference: { kind: 'any' },
          locale: 'en',
          history: []
        })
      )
    )
    render(
      <WalkInRouteFlow
        pathname={`/m/booking/s/walk-ins/wie_${status}`}
        locale="en"
        acknowledgment
      />
    )
    expect(await screen.findByText(label)).toBeTruthy()
  })

  it.each([
    ['walk_in_duplicate', 'You are already in this queue.'],
    ['walk_ins_unavailable', 'We could not add you to the queue.']
  ] as const)('submits enrollment and renders %s feedback', async (error, feedback) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(overview))
      .mockResolvedValueOnce(Response.json({ error }, { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    render(
      <WalkInRouteFlow
        pathname="/m/booking/s/walk-ins"
        locale="en"
        acknowledgment={false}
      />
    )
    await screen.findByRole('option', { name: 'Signature cut' })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mara' } })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'mara@example.test' }
    })
    fireEvent.change(screen.getByLabelText('Phone'), {
      target: { value: '+40711111111' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Join the queue' }))
    expect((await screen.findByRole('alert')).textContent).toBe(feedback)
    expect(fetch).toHaveBeenCalledTimes(2)
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
        expect(
          await screen.findByRole('button', { name: walkInCatalog[locale].join })
        ).toBeTruthy()
        expect(view.container.querySelector('[data-walk-in-viewport]')?.className).toBe(
          ''
        )
        view.unmount()
      }
    }
  )

  it.each([
    ['en', 'Walk-ins are closed right now.', 'Served'],
    ['es', 'La atención sin cita está cerrada ahora.', 'Atendido'],
    ['fr', 'Les inscriptions sont fermées pour le moment.', 'Terminé'],
    ['ro', 'Înscrierile sunt închise momentan.', 'Finalizat']
  ] as const)(
    'covers closed and terminal %s journeys at compact and wide viewports',
    async (locale, closedLabel, servedLabel) => {
      for (const width of [320, 1280]) {
        Object.defineProperty(window, 'innerWidth', {
          configurable: true,
          value: width
        })
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => Response.json({ ...overview, state: 'closed' }))
        )
        const closed = render(
          <WalkInRouteFlow
            pathname="/m/booking/s/walk-ins"
            locale={locale}
            acknowledgment={false}
          />
        )
        expect(await screen.findByText(closedLabel)).toBeTruthy()
        closed.unmount()

        vi.stubGlobal(
          'fetch',
          vi.fn(async () =>
            Response.json({
              id: 'wie_served',
              shopId: 'shp_one',
              status: 'served',
              position: 1,
              projectedWaitMinutes: 0,
              serviceId: 'svc_cut',
              providerPreference: { kind: 'any' },
              locale,
              history: []
            })
          )
        )
        const served = render(
          <WalkInRouteFlow
            pathname="/m/booking/s/walk-ins/wie_served"
            locale={locale}
            acknowledgment
          />
        )
        expect(await screen.findByText(servedLabel)).toBeTruthy()
        served.unmount()
      }
    }
  )

  it('does not fall back to a different service for an invalid service slug', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(overview))
    )
    render(
      <WalkInRouteFlow
        pathname="/m/booking/s/walk-ins"
        locale="en"
        acknowledgment={false}
        initialServiceId="missing-service"
      />
    )
    expect(await screen.findByText('Walk-ins are unavailable right now.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Join the queue' })).toBeNull()
  })
})
