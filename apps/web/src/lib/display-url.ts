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

const urlInText = /https?:\/\/[^\s]+?(?=[.,:;)]*(?:\s|$))/gu

/**
 * Free text with every URL in it shortened by {@link displayUrl}. Server copy
 * such as a webhook failure notification embeds the full endpoint URL, which
 * would otherwise bury the sentence around it.
 */
export function withDisplayUrls(text: string): string {
  return text.replaceAll(urlInText, (url) => displayUrl(url))
}
