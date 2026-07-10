/**
 * Settled application identifiers shared by deployment wiring and topology
 * smoke tests. Browser applications remain independent packages; this module
 * only prevents their deployment names and ingress binding from drifting.
 */
export const bookingProductWorkers = {
  web: { name: 'b2b-saas-starter-web', localPort: 3071 },
  merchant: { name: 'b2b-saas-starter-merchant', localPort: 3072 },
  booking: { name: 'b2b-saas-starter-booking', localPort: 3073 },
  api: { name: 'b2b-saas-starter-api', localPort: 8787 },
  background: { name: 'b2b-saas-starter-background', localPort: 8788 }
} as const

export const bookingServiceBinding = {
  name: 'BOOKING',
  service: bookingProductWorkers.booking.name
} as const
