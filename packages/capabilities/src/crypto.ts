/**
 * The package's single Web Crypto boundary. Consumers outside this package —
 * the background worker's webhook signature — import from here rather than
 * reaching for another crypto module.
 */
function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

export function hashSha256(value: string): Promise<string> {
  // oxlint-disable-next-line effect/noGlobals -- platform adapter: this module is the single Web Crypto boundary for the package; effect/Crypto has no Workers layer in core and would add a service requirement to every Live layer.
  return crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(value))
    .then(bytesToHex)
}

// oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto's HMAC API is promise-based; see hashSha256 above — this module is the single Web Crypto boundary for the package.
export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  // oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto awaits; see the note on the function
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  // oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto awaits; see the note on the function
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  )
  return bytesToHex(signed)
}

export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  // oxlint-disable-next-line effect/noGlobals -- platform adapter: signing secrets and bearer tokens need a CSPRNG; Effect's Random is a seedable PRNG and must not back credential material.
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Standard Webhooks uses a base64-encoded 256-bit key with a whsec_ prefix. */
export function randomWebhookSecret(): string {
  const bytes = new Uint8Array(32)
  // oxlint-disable-next-line effect/noGlobals -- platform adapter: webhook signing keys require a CSPRNG.
  crypto.getRandomValues(bytes)
  // oxlint-disable-next-line effect/noGlobals -- base64 encoding at the Web Crypto platform boundary.
  return `whsec_${btoa(String.fromCharCode(...bytes))}`
}

// oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto's HMAC API is promise-based at this platform boundary.
export async function hmacSha256Base64(
  secret: string,
  payload: string
): Promise<string> {
  // oxlint-disable-next-line effect/noGlobals -- base64 decoding at the Web Crypto platform boundary.
  const bytes = Uint8Array.from(atob(secret.slice('whsec_'.length)), (char) =>
    char.charCodeAt(0)
  )
  // oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto promise boundary.
  const key = await crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  // oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto promise boundary.
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  )
  // oxlint-disable-next-line effect/noGlobals -- base64 encoding at the Web Crypto platform boundary.
  return btoa(String.fromCharCode(...new Uint8Array(signed)))
}
