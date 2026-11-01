import { Schema } from 'effect'
import ipaddr from 'ipaddr.js'

/** Raised when the destination fails the shared SSRF/shape validation. */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class InvalidWebhookUrl extends Schema.TaggedError<InvalidWebhookUrl>()(
  'InvalidWebhookUrl',
  { url: Schema.String, reason: Schema.String },
  { httpApiStatus: 400 }
) {}

type WebhookUrlValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string }

// Keep application policy explicit: ipaddr's broader reserved-range categories
// would also reject addresses outside the starter's documented policy.
const blockedRanges = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '224.0.0.0/4',
  '::/128',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8'
].map((range) => ipaddr.parseCIDR(range))

/**
 * Shared creation/dispatch guard: HTTPS, no credentials, no localhost or
 * single-label hostnames, and no IP literals in the blocked ranges above.
 * IPv4-mapped IPv6 follows IPv4 policy. Non-default ports are allowed.
 * DNS resolution and rebinding protection are deliberately out of scope.
 */
export function validateWebhookUrl(raw: string): WebhookUrlValidation {
  const url = URL.parse(raw)
  if (url === null) {
    return { valid: false, reason: 'not a valid absolute URL' }
  }
  if (url.protocol !== 'https:') {
    return { valid: false, reason: 'must use https' }
  }
  if (url.username !== '' || url.password !== '') {
    return { valid: false, reason: 'must not embed credentials' }
  }
  const hostname = url.hostname.toLowerCase()
  if (hostname === '') {
    return { valid: false, reason: 'missing hostname' }
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { valid: false, reason: 'localhost destinations are not allowed' }
  }
  // WHATWG URL normalizes numeric IPv4 spellings and brackets IPv6 literals.
  let literal = hostname
  if (hostname.startsWith('[')) {
    literal = hostname.slice(1, -1)
  }
  if (ipaddr.isValid(literal)) {
    const address = ipaddr.process(literal)
    if (
      blockedRanges.some(
        ([network, prefix]) =>
          address.kind() === network.kind() && address.match(network, prefix)
      )
    ) {
      return {
        valid: false,
        reason:
          'IP-literal hosts in private, unspecified, loopback, link-local, carrier-grade NAT, protocol-assignment, or multicast ranges are not allowed'
      }
    }
    return { valid: true }
  }
  if (!hostname.includes('.')) {
    return { valid: false, reason: 'single-label hostnames are not allowed' }
  }
  return { valid: true }
}
