import { retainedCompatibilityIdentity } from './compatibility-identity.ts'
import { productionFixtureInvariantEvidence } from './fixture-evidence.ts'

export const productionIngress = [
  {
    kind: 'route',
    pattern: 'https://PUBLIC_SITE_ORIGIN/**',
    owner: 'Public Site (apps/web)',
    contract:
      'Editorial routes, Merchant public pages, and the canonical booking dispatcher',
    verification: 'apps/web Playwright route-ownership suite'
  },
  {
    kind: 'route',
    pattern: 'https://PUBLIC_SITE_ORIGIN/:merchantSlug/booking/**',
    owner: 'Booking App (apps/booking) through Public Site BOOKING service binding',
    contract:
      'Guest booking sessions, protected confirmations, waiting list, and walk-ins',
    verification:
      'apps/web booking-dispatch tests plus apps/booking HTTP contract tests'
  },
  {
    kind: 'deferred-route',
    candidateBlock: 'deferred-ingress',
    pattern: 'POST /:merchantSlug/booking/payment-callback/:provider',
    owner: 'Booking App payment provider edge',
    contract:
      'Compatibility-only appointment-payment callback; Pay In Person is the beesolo launch checkout path',
    verification: 'release candidate guard plus apps/booking/src/server.test.ts'
  },
  {
    kind: 'callback',
    pattern: 'POST /callbacks/stripe/subscriptions',
    owner: 'Solo Subscription callback edge (apps/api compatibility Worker)',
    contract: 'Signature-verified Stripe subscription entitlement projection',
    verification: 'apps/api/src/stripe-subscription-webhook.test.ts'
  },
  {
    kind: 'callback',
    pattern: 'POST /callbacks/email/transactional',
    owner: 'Transactional Email callback edge (apps/api compatibility Worker)',
    contract: 'Signature-verified Transactional Email delivery evidence',
    verification:
      'apps/api/src/index.test.ts typed-route test plus transactional-email-callback.test.ts'
  },
  {
    kind: 'route',
    pattern: 'https://MERCHANT_APP_ORIGIN/**',
    owner: 'Merchant App (apps/merchant)',
    contract: 'Owner authentication and one-Shop product operations',
    verification: 'apps/merchant browser route and authorization suites'
  },
  {
    kind: 'route',
    pattern: 'https://OPERATIONS_APP_ORIGIN/**',
    owner: 'Operations App (apps/operations)',
    contract: 'Platform-staff authentication and operational controls',
    verification: 'apps/operations browser route and runtime suites'
  },
  {
    kind: 'callback',
    pattern: 'GET|POST /callbacks/meta/whatsapp',
    owner: 'Operational Messaging callback edge (apps/api compatibility Worker)',
    contract:
      'Meta challenge and signed delivery callbacks only; not a Platform API promise',
    verification: 'apps/api/src/meta-whatsapp-callback.test.ts'
  },
  {
    kind: 'callback',
    pattern: 'POST /callbacks/smso/:pathSecret',
    owner: 'Operational Messaging callback edge (apps/api compatibility Worker)',
    contract: 'Secret-path SMSO delivery callback only; not a Platform API promise',
    verification: 'apps/api/src/smso-callback.test.ts'
  },
  {
    kind: 'deferred-route',
    candidateBlock: 'platform-api',
    pattern: 'https://PLATFORM_API_ORIGIN/{health,openapi.json,reference,v1/**}',
    owner: 'Legacy Platform API compatibility Worker (apps/api)',
    contract:
      'Must be absent from a beesolo launch candidate; callback extraction precedes retirement',
    verification: 'release candidate guard rejects this ingress kind'
  },
  {
    kind: 'queue-consumer',
    pattern: 'BOOKING_EVENTS_QUEUE -> apps/background',
    owner: 'Background Worker durable outbox recovery',
    contract: 'Queue messages are wakeups; D1 outbox remains authoritative',
    verification: 'infra binding drift tests and background outbox tests'
  },
  {
    kind: 'scheduled-trigger',
    pattern: '*/5 * * * * -> apps/background',
    owner: 'Background Worker recovery sweep',
    contract: 'Recovers committed outbox work and scheduled notification work',
    verification: 'apps/background scheduled-handler tests'
  }
] as const

export const renderIngressInventory = () => {
  const cell = (value: string) => value.replaceAll('|', '\\|')
  const rows = productionIngress
    .map(
      ({ kind, pattern, owner, contract, verification }) =>
        `| ${cell(kind)} | \`${cell(pattern)}\` | ${cell(owner)} | ${cell(contract)} | ${cell(verification)} |`
    )
    .join('\n')
  return `# beesolo Production Ingress Inventory

Generated from \`scripts/release-baseline/ingress.ts\`. Do not edit by hand.

| Kind | Ingress | Owning surface | Contract | Verification seam |
| --- | --- | --- | --- | --- |
${rows}

## Historical compatibility identity

The following names are retained until a separately verified forward-only cutover; they are resource identity, not active product identity:

${retainedCompatibilityIdentity.map((fact) => `- ${fact}`).join('\n')}

## Production fixture invariant evidence

These suites are executed by \`bun run release:baseline\`.

| Invariant | Verification seam |
| --- | --- |
${productionFixtureInvariantEvidence
  .map(({ invariant, seam }) => `| ${cell(invariant)} | ${cell(seam)} |`)
  .join('\n')}
`
}
