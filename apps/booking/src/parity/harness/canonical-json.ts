const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)])
    )
  }
  return value
}

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(normalize(value))

export const sha256Identity = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  return sha256Bytes(bytes)
}

export const sha256Bytes = async (bytes: Uint8Array): Promise<string> => {
  const input = Uint8Array.from(bytes).buffer
  const digest = await crypto.subtle.digest('SHA-256', input)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')}`
}
