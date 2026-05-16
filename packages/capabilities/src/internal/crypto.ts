export const bytesToHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )

export const hashSha256 = (value: string): Promise<string> =>
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then(bytesToHex)

export const randomHex = (byteLength: number): string => {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
