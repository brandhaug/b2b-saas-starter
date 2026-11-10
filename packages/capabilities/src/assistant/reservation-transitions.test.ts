import { describe, expect, it } from 'vite-plus/test'

import {
  canCommitReservation,
  isReservationAwaitingCommit,
  isReservationExpired,
  isReservationHeld,
  isReservationReleased,
  nextReservationStatus,
  reservationStatus
} from './reservation-transitions.ts'

const grace = 30_000
const now = 1_000_000
const deadline = now + 600_000

function reservation(
  fields: {
    readonly committedAt?: number | null
    readonly releasedAt?: number | null
    readonly deadline?: number
  } = {}
) {
  return {
    committedAt: null,
    releasedAt: null,
    deadline,
    ...fields
  }
}

describe('reservationStatus', () => {
  it('derives reserved from an untouched row', () => {
    expect(reservationStatus(reservation())).toBe('reserved')
  })

  it('derives committed once the attempt committed', () => {
    expect(reservationStatus(reservation({ committedAt: now }))).toBe('committed')
  })

  it('derives released when both writes exist, because release is terminal', () => {
    expect(
      reservationStatus(reservation({ committedAt: now, releasedAt: now + 1 }))
    ).toBe('released')
  })
})

describe('nextReservationStatus', () => {
  it('commits a reserved reservation inside its deadline', () => {
    expect(nextReservationStatus(reservation(), { kind: 'committed' }, now)).toBe(
      'committed'
    )
  })

  it('releases reserved and committed reservations', () => {
    expect(nextReservationStatus(reservation(), { kind: 'released' }, now)).toBe(
      'released'
    )
    expect(
      nextReservationStatus(
        reservation({ committedAt: now }),
        { kind: 'released' },
        now
      )
    ).toBe('released')
  })

  it('keeps an already-committed reservation committable inside its deadline', () => {
    expect(
      nextReservationStatus(
        reservation({ committedAt: now }),
        { kind: 'committed' },
        now
      )
    ).toBe('committed')
  })

  it('keeps release idempotent on a released reservation', () => {
    expect(
      nextReservationStatus(reservation({ releasedAt: now }), { kind: 'released' }, now)
    ).toBe('released')
  })

  it('expires unreleased reservations once the shutdown grace has elapsed', () => {
    expect(
      nextReservationStatus(
        reservation({ deadline: now - grace }),
        { kind: 'expired' },
        now
      )
    ).toBe('released')
    expect(
      nextReservationStatus(
        reservation({ committedAt: now - grace - 1, deadline: now - grace }),
        { kind: 'expired' },
        now
      )
    ).toBe('released')
  })

  it('refuses to commit a released reservation', () => {
    expect(
      nextReservationStatus(
        reservation({ committedAt: now, releasedAt: now + 1 }),
        { kind: 'committed' },
        now
      )
    ).toBeNull()
  })

  it('refuses to commit at or past the deadline', () => {
    expect(
      nextReservationStatus(reservation({ deadline: now }), { kind: 'committed' }, now)
    ).toBeNull()
    expect(
      nextReservationStatus(
        reservation({ deadline: now - 1 }),
        { kind: 'committed' },
        now
      )
    ).toBeNull()
  })

  it('refuses expiry before the shutdown grace has elapsed past the deadline', () => {
    expect(
      nextReservationStatus(
        reservation({ deadline: now - grace + 1 }),
        { kind: 'expired' },
        now
      )
    ).toBeNull()
  })

  it('refuses expiry on a released reservation', () => {
    expect(
      nextReservationStatus(
        reservation({ releasedAt: now, deadline: now - grace }),
        { kind: 'expired' },
        now
      )
    ).toBeNull()
  })
})

describe('reservation predicates', () => {
  it('holds unreleased reservations until deadline plus grace, and no longer', () => {
    expect(isReservationHeld(reservation(), now)).toBe(true)
    expect(isReservationHeld(reservation({ committedAt: now }), now)).toBe(true)
    expect(isReservationHeld(reservation({ deadline: now - grace + 1 }), now)).toBe(
      true
    )
    expect(isReservationHeld(reservation({ deadline: now - grace }), now)).toBe(false)
    expect(isReservationHeld(reservation({ releasedAt: now }), now)).toBe(false)
  })

  it('marks exactly the expired rows for reconciliation', () => {
    expect(isReservationExpired(reservation({ deadline: now - grace }), now)).toBe(true)
    expect(isReservationExpired(reservation({ deadline: now - grace + 1 }), now)).toBe(
      false
    )
    expect(isReservationExpired(reservation(), now)).toBe(false)
    expect(
      isReservationExpired(reservation({ releasedAt: now, deadline: now - grace }), now)
    ).toBe(false)
  })

  it('names committed and released rows', () => {
    expect(reservationStatus(reservation({ committedAt: now }))).toBe('committed')
    expect(reservationStatus(reservation())).toBe('reserved')
    expect(
      reservationStatus(reservation({ committedAt: now, releasedAt: now + 1 }))
    ).toBe('released')
    expect(isReservationReleased(reservation({ releasedAt: now }))).toBe(true)
    expect(isReservationReleased(reservation())).toBe(false)
  })
})

describe('commit admission', () => {
  it('admits only a first commit on an unreleased reservation inside its deadline', () => {
    expect(isReservationAwaitingCommit(reservation(), now)).toBe(true)
    expect(isReservationAwaitingCommit(reservation({ committedAt: now }), now)).toBe(
      false
    )
    expect(isReservationAwaitingCommit(reservation({ releasedAt: now }), now)).toBe(
      false
    )
    expect(isReservationAwaitingCommit(reservation({ deadline: now }), now)).toBe(false)
    expect(isReservationAwaitingCommit(undefined, now)).toBe(false)
  })

  it('keeps an ambiguous retry committable so it succeeds without a new audit write', () => {
    expect(canCommitReservation(reservation({ committedAt: now }), now)).toBe(true)
  })

  it('refuses commit without a row, after release, and past the deadline', () => {
    expect(canCommitReservation(undefined, now)).toBe(false)
    expect(canCommitReservation(reservation({ releasedAt: now }), now)).toBe(false)
    expect(canCommitReservation(reservation({ deadline: now }), now)).toBe(false)
  })
})
