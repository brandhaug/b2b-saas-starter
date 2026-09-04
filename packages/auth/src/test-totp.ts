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
