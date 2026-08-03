export const productionFixtureInvariantEvidence = [
  {
    invariant: 'Merchant isolation and sole Owner-Provider binding',
    seam: 'packages/capabilities/src/merchant-catalog/merchant-onboarding.test.ts'
  },
  {
    invariant: 'Conflict-safe holds derived from the canonical fixture',
    seam: 'packages/capabilities/src/booking/booking-scheduling.test.ts'
  },
  {
    invariant:
      'Immutable Appointment snapshots, transactional outbox, and replay convergence derived from the canonical fixture',
    seam: 'packages/capabilities/src/booking/booking-confirmation.test.ts'
  },
  {
    invariant:
      'Canonical-fixture network-fresh no-store reads and Public Site dispatch',
    seam: 'scripts/release-baseline/fixture-contract.test.ts'
  }
] as const

export const releaseBaselineVerificationSuites = [
  ...productionFixtureInvariantEvidence.map(({ seam }) => seam),
  'packages/capabilities/src/customer-directory/appointment-association.release.test.ts',
  'packages/capabilities/src/booking/booking-confirmation.live.test.ts',
  'apps/booking/src/lib/booking-session-http.test.ts',
  'apps/web/src/lib/booking-dispatch.test.ts',
  'apps/api/src/index.test.ts',
  'apps/api/src/transactional-email-callback.test.ts'
] as const
