export const productionFixtureInvariantEvidence = [
  {
    invariant: 'Merchant isolation and sole Owner-Provider binding',
    seam: 'packages/capabilities/src/merchant-catalog/merchant-onboarding.test.ts'
  },
  {
    invariant: 'Conflict-safe holds and immutable Appointment snapshots',
    seam: 'packages/capabilities/src/booking/booking-confirmation.live.test.ts'
  },
  {
    invariant: 'Transactional outbox atomicity and replay convergence',
    seam: 'packages/capabilities/src/booking/booking-confirmation.live.test.ts'
  },
  {
    invariant: 'Network-fresh private reads and no-store responses',
    seam: 'apps/booking/src/lib/booking-session-http.test.ts'
  },
  {
    invariant: 'Production Public Site dispatch through the Booking service binding',
    seam: 'apps/web/src/lib/booking-dispatch.test.ts'
  }
] as const
