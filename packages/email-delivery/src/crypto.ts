export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  // oxlint-disable-next-line effect/noGlobals -- credential fencing needs a CSPRNG; Effect's Random is a seedable PRNG.
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
