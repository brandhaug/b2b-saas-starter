/** These namespaces contain HTTP protocols, never page documents. */
export function isProtocolPath(pathname: string): boolean {
  return (
    pathname === '/ready' ||
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/.well-known' ||
    pathname.startsWith('/.well-known/')
  )
}
