export const customerImportFileId = async (
  rows: unknown,
  secret: string
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(JSON.stringify(rows))
  )
  return `customer-import:${Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')}`
}
