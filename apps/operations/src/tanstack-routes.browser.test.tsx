/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const server = vi.hoisted(() => ({
  acceptOperatorInvitation: vi.fn(),
  completeOperatorSecurityEnrollment: vi.fn(),
  getAuditEvent: vi.fn(),
  getAuditEvents: vi.fn(),
  getManagedOperators: vi.fn(),
  getMerchant: vi.fn(),
  getMerchantMember: vi.fn(),
  getOperationsSession: vi.fn(),
  getOperatorEnrollment: vi.fn(),
  inviteOperator: vi.fn(),
  searchOperations: vi.fn(),
  signInOperator: vi.fn(),
  startImpersonation: vi.fn(),
  startOperatorSecurityEnrollment: vi.fn(),
  verifyOperatorTotp: vi.fn()
}))

vi.mock('@/lib/server/operations.ts', () => server)

import { getRouter } from './router.tsx'

const ready = <A,>(data: A) => ({ state: 'ready' as const, data })

const merchant = {
  id: 'merchant-1',
  publicName: 'Northstar Studio',
  slug: 'northstar',
  status: 'active',
  publicPage: { status: 'published', bookingPath: '/northstar' },
  readiness: { ready: true, incomplete: [] },
  members: [
    {
      id: 'member-1',
      name: 'Mara Owner',
      email: 'mara@example.com',
      role: 'owner',
      status: 'active'
    }
  ]
}

const member = {
  id: 'member-1',
  name: 'Mara Owner',
  email: 'mara@example.com',
  emailVerified: true,
  enabled: true,
  membership: {
    merchantId: 'merchant-1',
    merchantName: 'Northstar Studio',
    role: 'owner'
  },
  activeSessionCount: 1,
  lastSignInAt: '2026-07-20T10:00:00.000Z',
  impersonationEligibility: { eligible: true, reason: null }
}

async function renderRoute(path: string) {
  const router = getRouter(createMemoryHistory({ initialEntries: [path] }))
  await router.load()
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  vi.clearAllMocks()
  server.getOperationsSession.mockResolvedValue(
    ready({
      principal: {
        id: 'operator-1',
        sessionId: 'session-1',
        email: 'operator@example.com',
        name: 'Olivia Operator',
        roles: ['merchant-reader'],
        idleExpiresAt: '2026-07-20T10:30:00.000Z',
        absoluteExpiresAt: '2026-07-20T18:00:00.000Z'
      }
    })
  )
  server.searchOperations.mockResolvedValue(ready({ results: [] }))
  server.getMerchant.mockResolvedValue(ready(merchant))
  server.getMerchantMember.mockResolvedValue(ready(member))
  server.getOperatorEnrollment.mockResolvedValue(
    ready({ email: 'invitee@example.com' })
  )
  server.getManagedOperators.mockResolvedValue(
    ready({ actorOperatorId: 'operator-1', operators: [] })
  )
  server.getAuditEvents.mockResolvedValue(ready({ events: [], nextCursor: null }))
  server.getAuditEvent.mockResolvedValue({ state: 'not-found' })
})

afterEach(cleanup)

describe('Operations TanStack routes', () => {
  it('renders sign-in and reports an authoritative form rejection', async () => {
    server.signInOperator.mockResolvedValue({
      state: 'rejected',
      message: 'Authentication was not accepted.'
    })
    await renderRoute('/sign-in')

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'operator@example.com' }
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong-password' }
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form')!)

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Authentication was not accepted.'
    )
  })

  it('navigates discovery, Merchant detail, and Member detail through typed routes', async () => {
    server.searchOperations.mockResolvedValueOnce(
      ready({
        results: [
          {
            kind: 'merchant',
            id: 'merchant-1',
            publicName: 'Northstar Studio',
            slug: 'northstar',
            status: 'active'
          }
        ]
      })
    )
    const router = await renderRoute('/?merchantQuery=northstar')
    expect(await screen.findByText('Northstar Studio')).toBeTruthy()

    await router.navigate({
      to: '/merchants/$merchantId',
      params: { merchantId: 'merchant-1' }
    })
    expect(await screen.findByText('Mara Owner')).toBeTruthy()

    await router.navigate({
      to: '/merchants/$merchantId/members/$memberId',
      params: { merchantId: 'merchant-1', memberId: 'member-1' }
    })
    expect(await screen.findByText('Create accountable Pending Handoff')).toBeTruthy()
  })

  it('keeps the impersonation ticket out of navigation and submits it by top-level POST', async () => {
    server.startImpersonation.mockResolvedValue(
      ready({
        handoffTicket: 'single-use-secret',
        expiresAt: '2026-07-20T10:01:00.000Z',
        merchantAppOrigin: 'https://merchant.example.com'
      })
    )
    await renderRoute('/merchants/merchant-1/members/member-1')
    fireEvent.change(screen.getByLabelText('Internal Impersonation Reason'), {
      target: { value: 'Investigate support case' }
    })
    fireEvent.change(screen.getByLabelText('Current authentication code'), {
      target: { value: '123456' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Pending Handoff' }))

    const continueButton = await screen.findByRole('button', {
      name: 'Continue to Merchant App'
    })
    const form = continueButton.closest('form')!
    expect(form.getAttribute('action')).toBe(
      'https://merchant.example.com/impersonation/handoffs/exchange'
    )
    expect(form.getAttribute('method')).toBe('post')
    expect((form.querySelector('input[name="ticket"]') as HTMLInputElement).value).toBe(
      'single-use-secret'
    )
    expect(window.location.href).not.toContain('single-use-secret')
  })

  it('renders enrollment expiry and authorization/session failures as distinct states', async () => {
    server.getOperatorEnrollment.mockResolvedValueOnce({ state: 'expired' })
    const router = await renderRoute('/enroll/security')
    expect(await screen.findByText(/sign in to resume incomplete/i)).toBeTruthy()

    server.getManagedOperators.mockResolvedValueOnce({ state: 'forbidden' })
    await router.navigate({
      to: '/operators',
      search: { result: undefined, error: undefined }
    })
    expect(await screen.findByText(/permissions do not allow/i)).toBeTruthy()

    server.getAuditEvents.mockResolvedValueOnce({ state: 'unauthenticated' })
    await router.navigate({ to: '/audit', search: {} })
    expect(await screen.findByText(/sign in again/i)).toBeTruthy()
  })

  it('renders management and audit records through the hydrated application', async () => {
    server.getManagedOperators.mockResolvedValueOnce(
      ready({
        actorOperatorId: 'operator-1',
        operators: [
          {
            id: 'operator-1',
            name: 'Olivia Operator',
            email: 'operator@example.com',
            enabled: true,
            enrollmentState: 'complete',
            roles: ['operator-manager'],
            activeSession: {
              active: true,
              absoluteExpiresAt: '2026-07-20T18:00:00.000Z'
            },
            lastSignInAt: '2026-07-20T10:00:00.000Z',
            createdAt: '2026-07-01T10:00:00.000Z',
            updatedAt: '2026-07-20T10:00:00.000Z'
          }
        ]
      })
    )
    const router = await renderRoute('/operators')
    expect(await screen.findByText('Olivia Operator')).toBeTruthy()

    server.getAuditEvents.mockResolvedValueOnce(
      ready({
        events: [
          {
            id: 'audit-1',
            actor: { id: 'operator-1', displayName: 'Olivia Operator' },
            operatorSessionId: 'session-1',
            impersonationId: null,
            target: null,
            merchant: { id: 'merchant-1', displayName: 'Northstar Studio' },
            action: 'operations.impersonation.started',
            result: 'accepted',
            occurredAt: '2026-07-20T10:00:00.000Z',
            retentionPolicy: 'impersonation-two-years',
            retainUntil: '2028-07-20T10:00:00.000Z'
          }
        ],
        nextCursor: null
      })
    )
    await router.navigate({ to: '/audit', search: {} })
    await waitFor(() =>
      expect(screen.getByText('operations.impersonation.started')).toBeTruthy()
    )
  })
})
