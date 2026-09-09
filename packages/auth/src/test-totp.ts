// oxlint-disable effect/noAsyncFunction, effect/noGlobals, effect/noTryCatch -- test-only clock shim advances the native authenticator without sleeping
/**
 * Base32 decode for the `secret` query parameter of a TOTP URI — shared by the
 * live suites that verify a generated code end to end.
 */
export function decodeUriSecret(encoded: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let buffer = 0
  let bits = 0
  const bytes: Array<number> = []
  for (const char of encoded) {
    const value = alphabet.indexOf(char)
    if (value === -1) {
      // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- a malformed secret is a programmer error in a test helper; the throw is the failure channel
      throw new Error(`bad base32 char: ${char}`)
    }
    buffer = (buffer << 5) | value
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 255)
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

/** Run a test authenticator in the next TOTP time window without sleeping. */
export async function withNextTotpWindow<A>(operation: () => Promise<A>): Promise<A> {
  const originalNow = Date.now
  const shiftedNow = originalNow() + 30_000
  Date.now = () => shiftedNow
  try {
    return await operation()
  } finally {
    Date.now = originalNow
  }
}
