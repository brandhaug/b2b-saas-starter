import { describe, expect, it } from 'vite-plus/test'

import { invitationStatuses } from '@b2b-saas-starter/db/enums'
import {
  initialInvitationStatus,
  isPendingInvitation,
  isTerminalInvitation,
  nextInvitationStatus,
  terminalInvitationStatuses
} from './workspace-invitations.ts'

describe('nextInvitationStatus', () => {
  it('settles a pending invitation to every terminal status', () => {
    expect(nextInvitationStatus('pending', 'accepted')).toBe('accepted')
    expect(nextInvitationStatus('pending', 'rejected')).toBe('rejected')
    // The plugin's single-`l` spelling, byte for byte.
    expect(nextInvitationStatus('pending', 'canceled')).toBe('canceled')
  })

  it('refuses every event against a settled invitation', () => {
    for (const status of terminalInvitationStatuses) {
      for (const event of ['accepted', 'rejected', 'canceled'] as const) {
        expect(nextInvitationStatus(status, event)).toBeNull()
      }
    }
  })
})

describe('invitation predicate sets', () => {
  it('keeps pending the single non-terminal status', () => {
    expect(initialInvitationStatus).toBe('pending')
    expect(terminalInvitationStatuses).toEqual(['accepted', 'rejected', 'canceled'])
  })

  it('partitions the stored vocabulary', () => {
    expect([...terminalInvitationStatuses].toSorted()).toEqual(
      [...invitationStatuses]
        .filter((status) => status !== initialInvitationStatus)
        .toSorted()
    )
    for (const status of invitationStatuses) {
      expect(isPendingInvitation(status)).toBe(status === 'pending')
      // Terminal means exactly `status <> 'pending'`, the boundary the
      // terminalAt triggers stamp.
      expect(isTerminalInvitation(status)).toBe(status !== 'pending')
    }
  })
})
