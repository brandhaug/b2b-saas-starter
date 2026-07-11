import { sha256Bytes } from './canonical-json.ts'

export const createContentStore = () => {
  const content = new Map<string, Uint8Array>()
  const get = (identity: string): Uint8Array => {
    const value = content.get(identity)
    if (!value) throw new Error(`Unknown content identity: ${identity}`)
    return Uint8Array.from(value)
  }
  return {
    async put(bytes: Uint8Array): Promise<string> {
      const identity = await sha256Bytes(bytes)
      content.set(identity, Uint8Array.from(bytes))
      return identity
    },
    get,
    response(identity: string, contentType = 'application/octet-stream'): Response {
      return new Response(Uint8Array.from(get(identity)).buffer, {
        headers: {
          'content-type': contentType,
          'cache-control': 'public, max-age=31536000, immutable',
          etag: `"${identity}"`
        }
      })
    }
  }
}
