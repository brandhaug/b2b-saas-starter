const operationsReturnPath = /^\/merchants\/[^/]+\/members\/[^/]+$/

export function safeOperationsReturnUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    const secure = url.protocol === 'https:'
    const localDevelopment =
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    if (
      (!secure && !localDevelopment) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !operationsReturnPath.test(url.pathname)
    )
      return null
    return url.href
  } catch {
    return null
  }
}
