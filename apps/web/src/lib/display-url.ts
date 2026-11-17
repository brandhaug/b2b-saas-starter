/**
 * A URL as a sentence can carry it: host and path, without the scheme, query
 * or fragment. Webhook URLs reach 2,048 characters, almost all of it query
 * string, which would turn a one-line summary into a paragraph; the full URL
 * stays on the record the summary links to. Unparseable input is returned
 * unchanged.
 */
export function displayUrl(url: string): string {
  if (!URL.canParse(url)) {
    return url
  }
  const { host, pathname, search, hash } = new URL(url)
  const path = pathname === '/' ? '' : pathname
  return `${host}${path}${search === '' && hash === '' ? '' : '?…'}`
}
