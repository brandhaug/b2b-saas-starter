import { Schema } from 'effect'

/**
 * Raised by `WebhookEndpoints.create` when the destination URL fails the
 * shared SSRF/shape validation below.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class InvalidWebhookUrl extends Schema.TaggedError<InvalidWebhookUrl>()(
  'InvalidWebhookUrl',
  { url: Schema.String, reason: Schema.String },
  { httpApiStatus: 400 }
) {}

export type WebhookUrlValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string }

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b = 0] = octets
  if (a === 0) return true // "this network" (0.0.0.0/8)
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // loopback (127.0.0.0/8)
  if (a === 169 && b === 254) return true // link-local (169.254.0.0/16)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  return false
}

const PRIVATE_RANGE_REASON =
  'IP-literal hosts in private, loopback, or link-local ranges are not allowed'

function checkIpv4Literal(hostname: string): string | null {
  const match = IPV4_PATTERN.exec(hostname)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) {
    return 'hostname is not a valid IPv4 address'
  }
  if (isPrivateIpv4(octets)) return PRIVATE_RANGE_REASON
  return null
}

function checkIpv6Literal(hostname: string): string | null {
  // URL.hostname wraps IPv6 literals in brackets.
  const literal = hostname.slice(1, -1).toLowerCase()
  if (literal === '::1' || literal === '::') {
    return 'IPv6 loopback or unspecified addresses are not allowed'
  }
  // IPv4-mapped IPv6 — check the embedded IPv4 address. WHATWG URL parsing
  // normalizes `::ffff:a.b.c.d` to hex groups (`::ffff:a00:1`), so handle
  // both spellings.
  const mappedDotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(literal)
  if (mappedDotted?.[1]) {
    return checkIpv4Literal(mappedDotted[1])
  }
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(literal)
  const [, highGroup, lowGroup] = mappedHex ?? []
  if (highGroup !== undefined && lowGroup !== undefined) {
    const high = Number.parseInt(highGroup, 16)
    const low = Number.parseInt(lowGroup, 16)
    const octets = [high >> 8, high & 0xff, low >> 8, low & 0xff]
    if (isPrivateIpv4(octets)) return PRIVATE_RANGE_REASON
    return null
  }
  const firstGroup = literal.split(':', 1)[0] ?? ''
  const prefix = Number.parseInt(firstGroup.padEnd(4, '0'), 16)
  if (Number.isNaN(prefix)) {
    return 'hostname is not a valid IPv6 address'
  }
  if (prefix >= 0xfc_00 && prefix <= 0xfd_ff) {
    return 'IPv6 unique-local addresses (fc00::/7) are not allowed'
  }
  if (prefix >= 0xfe_80 && prefix <= 0xfe_bf) {
    return 'IPv6 link-local addresses (fe80::/10) are not allowed'
  }
  return null
}

/**
 * Pure SSRF/shape guard for outbound webhook destinations. Applied at endpoint
 * creation (`WebhookEndpoints.create`) and re-checked at dispatch time in
 * `apps/background` so a URL that was valid at creation cannot be replayed
 * against an internal target after a rule change.
 *
 * Rules: https only, no credentials in the URL, no `localhost` or single-label
 * hostnames, and no IP-literal hosts in private, loopback, or link-local
 * ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0/8, ::1, fc00::/7,
 * fe80::/10). Non-default ports are allowed. DNS-rebinding protection
 * (resolving the hostname and pinning the connection to a vetted address) is
 * deliberately out of scope for the starter.
 */
export function validateWebhookUrl(raw: string): WebhookUrlValidation {
  // `URL.parse` reports an unparseable URL as `null` instead of throwing, so
  // the whole guard stays a pure total function with no exception path.
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
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    const reason = checkIpv6Literal(hostname)
    if (reason) return { valid: false, reason }
    return { valid: true }
  }
  const ipv4Reason = checkIpv4Literal(hostname)
  if (ipv4Reason) {
    return { valid: false, reason: ipv4Reason }
  }
  if (!hostname.includes('.')) {
    return {
      valid: false,
      reason: 'single-label hostnames are not allowed'
    }
  }
  return { valid: true }
}
