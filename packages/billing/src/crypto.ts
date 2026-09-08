function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

// oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto's HMAC API is promise-based; Stripe signature verification uses the platform Web Crypto implementation.
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
