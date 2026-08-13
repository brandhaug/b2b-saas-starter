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

export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  // oxlint-disable-next-line effect/noGlobals -- platform adapter: signing secrets and bearer tokens need a CSPRNG; Effect's Random is a seedable PRNG and must not back credential material.
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
