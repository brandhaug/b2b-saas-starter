// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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
  BookingStatus: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
  )
}))
import { WaitingListRouteFlow } from './waiting-list-route-flow.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WaitingListRouteFlow', () => {
  it('renders the application journey', () => {
    render(<WaitingListRouteFlow pathname="/shop/booking/waiting-list" application />)
    expect(screen.getByRole('heading', { name: 'Join the waiting list' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join the waiting list' })).toBeTruthy()
  })

  it('renders a protected offer and its responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          state: 'offer',
          offer: {
            id: 'avo_1',
            applicationId: 'wla_1',
            status: 'pending',
            slot: {
              shopId: 'shp_1',
              serviceIds: ['svc_1'],
              providerId: 'prv_1',
              startsAt: '2026-07-14T09:00:00.000Z',
              endsAt: '2026-07-14T09:30:00.000Z'
            },
            createdAt: '2026-07-12T12:00:00.000Z',
            expiresAt: '2026-07-13T00:00:00.000Z',
            respondedAt: null,
            bookingSessionId: null
          }
        })
      )
    )
    render(
      <WaitingListRouteFlow pathname="/shop/booking/waiting-list/wla_1/offers/avo_1" />
    )
    expect(
      await screen.findByRole('button', { name: 'Accept and continue' })
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy()
  })

  it.each([
    ['en', 'Join the waiting list', 'Email'],
    ['es', 'Únete a la lista de espera', 'Correo'],
    ['fr', 'Rejoindre la liste d’attente', 'E-mail'],
    ['ro', 'Înscrie-te pe lista de așteptare', 'E-mail']
  ] as const)(
    'keeps the %s application complete and operable',
    (locale, title, email) => {
      render(
        <WaitingListRouteFlow
          pathname="/shop/booking/waiting-list"
          application
          locale={locale}
        />
      )
      expect(screen.getByRole('heading', { name: title })).toBeTruthy()
      expect(screen.getByLabelText(email)).toBeTruthy()
      expect(screen.getByRole('button', { name: title })).toBeTruthy()
    }
  )
})
