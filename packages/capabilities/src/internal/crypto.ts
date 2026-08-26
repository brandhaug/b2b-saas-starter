export function bytesToHex(bytes: ArrayBuffer): string {
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

/** Canonical `t=<ts>,v1=<hex>` header form shared by signature schemes. */
export function signatureHeader(timestamp: string, signature: string): string {
  return `t=${timestamp},v1=${signature}`
}

export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  // oxlint-disable-next-line effect/noGlobals -- platform adapter: signing secrets and bearer tokens need a CSPRNG; Effect's Random is a seedable PRNG and must not back credential material.
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
