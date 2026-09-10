/**
 * Random hex from the platform CSPRNG.
 *
 * Signing secrets, bearer tokens and claim fences are credential material:
 * Effect's `Random` is a seedable PRNG and must never back them. Every package
 * that mints such a value needs these bytes, so the platform call and its lint
 * suppression live here once rather than in a copy per package.
 */
export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  // oxlint-disable-next-line effect/noGlobals -- platform adapter: credential material needs a CSPRNG, and Effect's Random is a seedable PRNG.
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
