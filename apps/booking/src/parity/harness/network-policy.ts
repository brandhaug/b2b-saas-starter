export const createNetworkPolicy = (input: {
  readonly allow: readonly string[]
  readonly localAssetOrigin?: string
}) => {
  const allowed = new Set([...input.allow, input.localAssetOrigin].filter(Boolean))
  const observed: { url: string; allowed: boolean }[] = []
  return {
    assertAllowed(url: string) {
      const origin = new URL(url).origin
      const isAllowed = allowed.has(origin)
      observed.push({ url, allowed: isAllowed })
      if (!isAllowed) throw new Error(`Undeclared network request: ${url}`)
    },
    requests: () => structuredClone(observed)
  }
}
