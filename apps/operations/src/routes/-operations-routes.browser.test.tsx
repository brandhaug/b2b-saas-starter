/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const server = vi.hoisted(() => ({
  acceptOperatorInvitation: vi.fn(),
  approveMessagingRecovery: vi.fn(),
  completeOperatorSecurityEnrollment: vi.fn(),
  completeMessagingRecovery: vi.fn(),
  containMessagingIncident: vi.fn(),
  correctMessagingLedgerEntry: vi.fn(),
  deleteOperator: vi.fn(),
  getAuditEvent: vi.fn(),
  getAuditEvents: vi.fn(),
  getManagedOperators: vi.fn(),
  getMessagingCase: vi.fn(),
  getMessagingContainment: vi.fn(),
  getMessagingFinance: vi.fn(),
  getMessagingIncidents: vi.fn(),
  getMessagingOverview: vi.fn(),
  getMessagingReconciliation: vi.fn(),
  getMerchant: vi.fn(),
  getMerchantMember: vi.fn(),
  getOperationsSession: vi.fn(),
  getOperatorEnrollment: vi.fn(),
  inviteOperator: vi.fn(),
  openMessagingIncident: vi.fn(),
  recordMessagingCredentialRotation: vi.fn(),
  recordMessagingRecoveryCheck: vi.fn(),
  requestMessagingProviderQuery: vi.fn(),
  resolveMessagingCase: vi.fn(),
  revokeOperatorInvitation: vi.fn(),
  searchOperations: vi.fn(),
  setOperatorEnabled: vi.fn(),
  signInOperator: vi.fn(),
  startImpersonation: vi.fn(),
  startOperatorSecurityEnrollment: vi.fn(),
  updateOperatorRoles: vi.fn(),
  verifyOperatorTotp: vi.fn()
}))

const authClient = vi.hoisted(() => ({ signOut: vi.fn() }))

vi.mock('@/lib/server/operations-server-functions.ts', () => server)
vi.mock('@b2b-saas-starter/auth/operations/client', () => ({
  operationsAuthClient: authClient
}))

import { getRouter } from '../router.tsx'
import { useOperationsSignOut } from '@/hooks/use-operations-sign-out.ts'

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
  authClient.signOut.mockResolvedValue({ data: { success: true }, error: null })
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
  server.getMessagingOverview.mockResolvedValue(
    ready({
      health: {
        openCaseCount: 1,
        ambiguousCount: 1,
        complaintCount: 0,
        deliveredRouteCount: 23,
        merchantChargeMilliEuro: 1035,
        providerCostCount: 21,
        providerCostMilliEuro: 712.5
      },
      cases: [
        {
          caseId: 'case-1',
          shopId: 'shop-1',
          merchantId: 'merchant-1',
          merchantName: 'Northstar Studio',
          intentId: 'intent-1',
          purpose: 'appointment_confirmation',
          maskedDestination: '+40•••••••456',
          kind: 'ambiguous_submission',
          status: 'open',
          severity: 'high',
          safeSummary: 'Submission evidence needs review',
          openedAt: '2026-07-30T12:00:00.000Z'
        }
      ]
    })
  )
  server.getMessagingCase.mockResolvedValue(
    ready({
      case: {
        caseId: 'case-1',
        shopId: 'shop-1',
        merchantId: 'merchant-1',
        merchantName: 'Northstar Studio',
        intentId: 'intent-1',
        purpose: 'appointment_confirmation',
        maskedDestination: '+40•••••••456',
        kind: 'ambiguous_submission',
        status: 'open',
        severity: 'high',
        safeSummary: 'Submission evidence needs review',
        openedAt: '2026-07-30T12:00:00.000Z'
      },
      intent: {
        intentId: 'intent-1',
        sourceType: 'appointment',
        sourceId: 'appointment-1',
        sourceVersion: 1,
        purpose: 'appointment_confirmation',
        phase: 'awaiting_provider',
        maskedDestination: '+40•••••••456',
        availableAt: '2026-07-30T12:00:00.000Z'
      },
      routes: [
        {
          routeId: 'route-1',
          ordinal: 0,
          channel: 'whatsapp',
          provider: 'meta',
          state: 'accepted',
          acceptedAt: '2026-07-30T12:01:00.000Z'
        },
        {
          routeId: 'route-2',
          ordinal: 1,
          channel: 'sms',
          provider: 'smso',
          state: 'accepted',
          acceptedAt: '2026-07-30T12:02:00.000Z'
        }
      ],
      attempts: [
        {
          attemptId: 'attempt-1',
          routeId: 'route-1',
          ordinal: 0,
          state: 'accepted',
          startedAt: '2026-07-30T12:00:30.000Z',
          completedAt: '2026-07-30T12:01:00.000Z'
        }
      ],
      evidence: [
        {
          evidenceId: 'evidence-1',
          attemptId: 'attempt-1',
          routeId: 'route-1',
          provider: 'meta',
          source: 'callback',
          status: 'accepted',
          trusted: true,
          normalizedCode: 'accepted',
          observedAt: '2026-07-30T12:01:00.000Z'
        }
      ],
      reservation: {
        reservationId: 'reservation-1',
        rateCardId: 'rate-card-1',
        amountMilliEuro: 45,
        status: 'active',
        expiresAt: '2026-08-06T12:00:00.000Z'
      },
      charges: [],
      providerCosts: [],
      ledgerEntries: [],
      reconciliation: { status: 'open', resolutions: [] },
      complaints: []
    })
  )
  server.getMessagingContainment.mockResolvedValue(ready({ controls: [] }))
  server.getMessagingFinance.mockResolvedValue(
    ready({
      rateCards: [],
      balances: [],
      charges: [],
      providerCosts: [],
      ledgerEntries: []
    })
  )
  server.getMessagingReconciliation.mockResolvedValue(ready({ cases: [] }))
  server.getMessagingIncidents.mockResolvedValue(ready({ incidents: [] }))
  server.resolveMessagingCase.mockResolvedValue(ready(null))
  server.containMessagingIncident.mockResolvedValue(ready(null))
})

afterEach(cleanup)

describe('Operations TanStack routes', () => {
  it('renders when browser storage is unavailable', async () => {
    const browserStorage = globalThis.localStorage
    vi.stubGlobal('localStorage', {})

    try {
      await renderRoute('/')
      expect(await screen.findByText('System Operator')).toBeTruthy()
    } finally {
      vi.stubGlobal('localStorage', browserStorage)
    }
  })

  it('renders protected routes inside the Operations sidebar shell', async () => {
    await renderRoute('/')

    const sidebarTrigger = screen.getByRole('button', { name: 'Toggle Sidebar' })
    expect(sidebarTrigger).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'breadcrumb' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Discovery' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Operators' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Audit' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Messaging' })).toBeTruthy()
    expect(screen.getByText('System Operator')).toBeTruthy()

    fireEvent.click(sidebarTrigger)
    await waitFor(() =>
      expect(
        document.querySelector('[data-slot=sidebar][data-state=collapsed]')
      ).toBeTruthy()
    )
  })

  it('renders the messaging health queue and focused normalized evidence journey', async () => {
    server.requestMessagingProviderQuery.mockResolvedValue(ready(null))
    const router = await renderRoute('/messaging?q=456')

    expect(
      await screen.findByRole('heading', { name: 'Messaging health' })
    ).toBeTruthy()
    expect(screen.getByText(/Northstar Studio/)).toBeTruthy()
    expect(screen.getByText(/\+40•••••••456/)).toBeTruthy()
    expect(screen.getByText(/Appointment confirmation/)).toBeTruthy()
    expect(screen.getByText(/Age:/)).toBeTruthy()
    const caseLink = screen.getByRole('link', {
      name: /submission evidence needs review/i
    })
    expect(caseLink.getAttribute('href')).toContain('/messaging/cases/case-1')
    expect(server.getMessagingOverview).toHaveBeenCalled()

    await router.navigate({
      to: '/messaging/cases/$caseId',
      params: { caseId: 'case-1' }
    })
    expect(await screen.findByRole('heading', { name: 'Messaging case' })).toBeTruthy()
    expect(screen.getByText('Ordered route journey')).toBeTruthy()
    expect(screen.getByText('Normalized provider evidence')).toBeTruthy()
    expect(screen.getByText(/45 m€/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('raw callback')
    expect(document.body.textContent).not.toContain('Confirmation URL')

    fireEvent.change(screen.getByLabelText('Provider query reason'), {
      target: { value: 'Refresh ambiguous delivery evidence from SMSO' }
    })
    fireEvent.click(screen.getByLabelText('Confirm authoritative provider query'))
    fireEvent.submit(
      screen.getByRole('button', { name: 'Queue provider query' }).closest('form')!
    )
    await waitFor(() =>
      expect(server.requestMessagingProviderQuery).toHaveBeenCalledWith({
        data: {
          caseId: 'case-1',
          reason: 'Refresh ambiguous delivery evidence from SMSO',
          confirmed: true
        }
      })
    )

    fireEvent.change(screen.getByLabelText('Resolution classification'), {
      target: { value: 'provider-confirmed' }
    })
    fireEvent.change(screen.getByLabelText('Evidence source'), {
      target: { value: 'provider-query:case-1' }
    })
    fireEvent.change(screen.getByLabelText('Substantive reason'), {
      target: { value: 'Authoritative provider query confirmed acceptance' }
    })
    fireEvent.click(screen.getByLabelText('Confirm append-only resolution'))
    fireEvent.submit(
      screen.getByRole('button', { name: 'Append resolution' }).closest('form')!
    )
    await waitFor(() =>
      expect(server.resolveMessagingCase).toHaveBeenCalledWith({
        data: {
          caseId: 'case-1',
          disposition: 'resolved',
          classification: 'provider-confirmed',
          source: 'provider-query:case-1',
          reason: 'Authoritative provider query confirmed acceptance',
          confirmed: true
        }
      })
    )
  })

  it('previews and confirms the narrow containment change', async () => {
    server.getMessagingContainment.mockResolvedValue(
      ready({
        controls: [
          {
            controlId: 'control-1',
            environment: 'production',
            channel: 'whatsapp',
            provider: 'meta',
            enabled: true,
            reason: 'Healthy route',
            updatedAt: '2026-07-30T12:00:00.000Z'
          }
        ]
      })
    )
    server.getMessagingIncidents.mockResolvedValue(
      ready({
        incidents: [
          {
            incidentId: 'incident-1',
            shopId: 'shop-1',
            kind: 'duplicate_delivery',
            status: 'open',
            severity: 'high',
            safeSummary: 'One Merchant has duplicate delivery evidence',
            containmentScope: 'merchant',
            controlLabel: 'Merchant shop-1',
            controlBefore: 'Merchant messaging enabled',
            controlAfter: 'Merchant messaging frozen',
            recoveryApprovalCount: 0,
            requiredRecoveryApprovals: 1,
            openedAt: '2026-07-30T12:00:00.000Z'
          }
        ]
      })
    )
    await renderRoute('/messaging/containment')

    const preview = await screen.findByLabelText('Containment preview')
    expect(preview.textContent).toContain('Before: Merchant messaging enabled')
    expect(preview.textContent).toContain('After: Merchant messaging frozen')
    expect(preview.textContent).toContain('Exact control: Merchant shop-1')
    fireEvent.change(screen.getByLabelText('Containment reason'), {
      target: { value: 'Freeze only the affected Merchant while evidence is reviewed' }
    })
    fireEvent.click(screen.getByLabelText('Confirm narrow containment'))
    fireEvent.submit(
      screen.getByRole('button', { name: 'Contain incident' }).closest('form')!
    )
    await waitFor(() =>
      expect(server.containMessagingIncident).toHaveBeenCalledWith({
        data: {
          incidentId: 'incident-1',
          reason: 'Freeze only the affected Merchant while evidence is reviewed',
          confirmed: true
        }
      })
    )
  })

  it('keeps control posture usable without incident permission', async () => {
    server.getMessagingContainment.mockResolvedValue(
      ready({
        controls: [
          {
            controlId: 'control-only',
            environment: 'production',
            channel: 'sms',
            provider: 'smso',
            enabled: false,
            reason: 'Provider route paused',
            updatedAt: '2026-07-30T12:00:00.000Z'
          }
        ]
      })
    )
    server.getMessagingIncidents.mockResolvedValue({ state: 'forbidden' })
    await renderRoute('/messaging/containment')

    expect(await screen.findByText('Provider route paused')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Permission required' })).toBeTruthy()
  })

  it('records recovery evidence and confirms exact-scope re-enablement', async () => {
    server.getMessagingIncidents.mockResolvedValue(
      ready({
        incidents: [
          {
            incidentId: 'incident-recovery',
            provider: 'meta',
            channel: 'whatsapp',
            kind: 'forged_callback',
            status: 'recovering',
            severity: 'critical',
            safeSummary: 'Callback signature validation was contained',
            containmentScope: 'callback_rule',
            controlLabel: 'meta / whatsapp callbacks',
            controlBefore: 'Callback rule paused',
            controlAfter: 'Callback rule paused',
            recoveryApprovalCount: 1,
            requiredRecoveryApprovals: 1,
            openedAt: '2026-07-30T12:00:00.000Z'
          }
        ]
      })
    )
    server.recordMessagingRecoveryCheck.mockResolvedValue(ready(null))
    server.completeMessagingRecovery.mockResolvedValue(ready(null))
    await renderRoute('/messaging/containment')

    fireEvent.click(await screen.findByText('Recovery evidence and approval'))
    fireEvent.change(screen.getByLabelText('Evidence reference'), {
      target: { value: 'probe:callback-signature:42' }
    })
    fireEvent.change(screen.getAllByLabelText('Reason')[0]!, {
      target: { value: 'Production signature probes now pass consistently' }
    })
    fireEvent.click(screen.getByLabelText('Confirm recovery evidence'))
    fireEvent.submit(
      screen.getByRole('button', { name: 'Record recovery check' }).closest('form')!
    )
    await waitFor(() => expect(server.recordMessagingRecoveryCheck).toHaveBeenCalled())

    const preview = screen.getByLabelText('Recovery preview')
    expect(preview.textContent).toContain('resolved and scope re-enabled')
    fireEvent.change(screen.getByLabelText('Completion reason'), {
      target: { value: 'All required recovery evidence and approvals are current' }
    })
    fireEvent.click(
      screen.getByLabelText('Confirm recovery and re-enable the exact scope')
    )
    fireEvent.submit(
      screen.getByRole('button', { name: 'Complete recovery' }).closest('form')!
    )
    await waitFor(() =>
      expect(server.completeMessagingRecovery).toHaveBeenCalledWith({
        data: {
          incidentId: 'incident-recovery',
          reason: 'All required recovery evidence and approvals are current',
          confirmed: true
        }
      })
    )
  })

  it('previews and appends a compensating finance correction', async () => {
    server.getMessagingFinance.mockResolvedValue(
      ready({
        rateCards: [],
        balances: [],
        charges: [],
        providerCosts: [],
        ledgerEntries: [
          {
            entryId: 'ledger-1',
            shopId: 'shop-1',
            direction: 'debit',
            kind: 'operator_adjustment',
            amountMilliEuro: 450,
            currency: 'EUR',
            occurredAt: '2026-07-30T12:00:00.000Z',
            reversed: false
          }
        ]
      })
    )
    server.correctMessagingLedgerEntry.mockResolvedValue(ready(null))
    await renderRoute('/messaging/finance')

    fireEvent.click(await screen.findByText('Preview correction'))
    expect(screen.getByLabelText('Correction preview').textContent).toContain(
      'append credit 450 m€'
    )
    fireEvent.change(screen.getByLabelText('Stable correction code'), {
      target: { value: 'incorrect-operator-adjustment' }
    })
    fireEvent.change(screen.getByLabelText('Substantive reason'), {
      target: { value: 'The source reconciliation proves this debit was invalid' }
    })
    fireEvent.click(screen.getByLabelText('Confirm compensating entry'))
    fireEvent.submit(
      screen.getByRole('button', { name: 'Append correction' }).closest('form')!
    )
    await waitFor(() =>
      expect(server.correctMessagingLedgerEntry).toHaveBeenCalledWith({
        data: {
          shopId: 'shop-1',
          entryId: 'ledger-1',
          correctionReason: 'incorrect-operator-adjustment',
          reason: 'The source reconciliation proves this debit was invalid',
          confirmed: true
        }
      })
    )
  })

  it('redirects an anonymous protected navigation to sign-in', async () => {
    server.getOperationsSession.mockResolvedValueOnce({ state: 'unauthenticated' })
    const router = await renderRoute('/')

    expect(router.state.location.pathname).toBe('/sign-in')
    expect(
      await screen.findByRole('heading', { name: 'Operations sign in' })
    ).toBeTruthy()
  })

  it('signs out through the Better Auth browser client', async () => {
    authClient.signOut.mockResolvedValueOnce({
      data: null,
      error: { message: 'Sign out rejected' }
    })
    const { result } = renderHook(() => useOperationsSignOut())

    act(() => result.current.signOut())

    await waitFor(() => expect(authClient.signOut).toHaveBeenCalledOnce())
    await waitFor(() => expect(result.current.pending).toBe(false))
  })

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

  it('creates and revokes an operator invitation through typed mutations', async () => {
    server.inviteOperator.mockResolvedValueOnce(
      ready({
        invitation: {
          id: 'invitation-1',
          email: 'new-operator@example.com',
          expiresAt: '2026-07-21T10:00:00.000Z'
        }
      })
    )
    server.revokeOperatorInvitation.mockResolvedValueOnce(ready(null))
    await renderRoute('/operators/invitations/new')

    fireEvent.change(screen.getByLabelText('Dedicated operator email'), {
      target: { value: 'new-operator@example.com' }
    })
    fireEvent.click(screen.getByLabelText('Messaging Reader'))
    fireEvent.click(screen.getByLabelText('Messaging Incident Responder'))
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Send single-use invitation' })
        .closest('form')!
    )
    expect(await screen.findByText(/invitation sent to new-operator/i)).toBeTruthy()
    expect(server.inviteOperator).toHaveBeenCalledWith({
      data: {
        email: 'new-operator@example.com',
        roles: ['messaging-reader', 'messaging-incident-responder']
      }
    })
    fireEvent.click(screen.getByText('Revoke invitation'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke invitation' }))

    await waitFor(() =>
      expect(server.revokeOperatorInvitation).toHaveBeenCalledWith({
        data: { invitationId: 'invitation-1' }
      })
    )
  })

  it('completes TOTP and backup-code enrollment through the TanStack route', async () => {
    server.startOperatorSecurityEnrollment.mockResolvedValueOnce(
      ready({
        totpURI: 'otpauth://totp/Operations:invitee?secret=SETUPKEY',
        backupCodes: ['backup-one', 'backup-two']
      })
    )
    server.completeOperatorSecurityEnrollment.mockResolvedValueOnce(ready(null))
    await renderRoute('/enroll/security')

    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'enrollment-password' }
    })
    fireEvent.submit(
      screen.getByRole('button', { name: 'Set up authenticator' }).closest('form')!
    )
    expect(await screen.findByText('backup-one')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Authentication code'), {
      target: { value: '123456' }
    })
    fireEvent.click(screen.getByLabelText('I stored my backup codes'))
    fireEvent.submit(
      screen.getByRole('button', { name: 'Complete enrollment' }).closest('form')!
    )

    await waitFor(() =>
      expect(server.completeOperatorSecurityEnrollment).toHaveBeenCalledWith({
        data: { code: '123456', backupCodesConfirmed: 'yes' }
      })
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
    server.getManagedOperators.mockResolvedValue(
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

  it('submits operator role changes through the typed TanStack mutation', async () => {
    server.getManagedOperators.mockResolvedValueOnce(
      ready({
        actorOperatorId: 'operator-1',
        operators: [
          {
            id: 'operator-2',
            name: 'Morgan Support',
            email: 'morgan@example.com',
            enabled: true,
            enrollmentState: 'complete',
            roles: ['merchant-reader'],
            activeSession: { active: false, absoluteExpiresAt: null },
            lastSignInAt: null,
            createdAt: '2026-07-01T10:00:00.000Z',
            updatedAt: '2026-07-20T10:00:00.000Z'
          }
        ]
      })
    )
    server.updateOperatorRoles.mockResolvedValueOnce(ready(null))
    await renderRoute('/operators')

    fireEvent.click(screen.getByLabelText('Messaging Reconciler'))
    fireEvent.submit(
      screen.getByRole('button', { name: 'Save roles' }).closest('form')!
    )

    await waitFor(() =>
      expect(server.updateOperatorRoles).toHaveBeenCalledWith({
        data: {
          operatorId: 'operator-2',
          expectedUpdatedAt: '2026-07-20T10:00:00.000Z',
          roles: ['merchant-reader', 'messaging-reconciler']
        }
      })
    )
  })

  it('renders authoritative operator mutation failures without navigation', async () => {
    server.getManagedOperators.mockResolvedValue(
      ready({
        actorOperatorId: 'operator-1',
        operators: [
          {
            id: 'operator-2',
            name: 'Morgan Support',
            email: 'morgan@example.com',
            enabled: true,
            enrollmentState: 'complete',
            roles: ['merchant-reader'],
            activeSession: { active: false, absoluteExpiresAt: null },
            lastSignInAt: null,
            createdAt: '2026-07-01T10:00:00.000Z',
            updatedAt: '2026-07-20T10:00:00.000Z'
          }
        ]
      })
    )
    server.updateOperatorRoles.mockResolvedValueOnce({
      state: 'conflict',
      message: 'Authoritative state changed or the action conflicts with open work.'
    })
    await renderRoute('/operators')

    fireEvent.submit(
      screen.getByRole('button', { name: 'Save roles' }).closest('form')!
    )

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Authoritative state changed'
    )
  })

  it('submits operator enabled-state changes through the typed TanStack mutation', async () => {
    server.getManagedOperators.mockResolvedValueOnce(
      ready({
        actorOperatorId: 'operator-1',
        operators: [
          {
            id: 'operator-2',
            name: 'Morgan Support',
            email: 'morgan@example.com',
            enabled: true,
            enrollmentState: 'complete',
            roles: ['merchant-reader'],
            activeSession: { active: false, absoluteExpiresAt: null },
            lastSignInAt: null,
            createdAt: '2026-07-01T10:00:00.000Z',
            updatedAt: '2026-07-20T10:00:00.000Z'
          }
        ]
      })
    )
    server.setOperatorEnabled.mockResolvedValueOnce(ready(null))
    await renderRoute('/operators')

    fireEvent.click(screen.getByRole('button', { name: 'Disable operator' }))

    await waitFor(() =>
      expect(server.setOperatorEnabled).toHaveBeenCalledWith({
        data: {
          operatorId: 'operator-2',
          expectedUpdatedAt: '2026-07-20T10:00:00.000Z',
          enabled: false
        }
      })
    )
  })

  it('submits confirmed operator deletion through the typed TanStack mutation', async () => {
    server.getManagedOperators.mockResolvedValueOnce(
      ready({
        actorOperatorId: 'operator-1',
        operators: [
          {
            id: 'operator-2',
            name: 'Morgan Support',
            email: 'morgan@example.com',
            enabled: false,
            enrollmentState: 'complete',
            roles: ['merchant-reader'],
            activeSession: { active: false, absoluteExpiresAt: null },
            lastSignInAt: null,
            createdAt: '2026-07-01T10:00:00.000Z',
            updatedAt: '2026-07-20T10:00:00.000Z'
          }
        ]
      })
    )
    server.deleteOperator.mockResolvedValueOnce(ready(null))
    await renderRoute('/operators')

    fireEvent.click(screen.getByText('Delete operator'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() =>
      expect(server.deleteOperator).toHaveBeenCalledWith({
        data: {
          operatorId: 'operator-2',
          expectedUpdatedAt: '2026-07-20T10:00:00.000Z'
        }
      })
    )
  })
})
