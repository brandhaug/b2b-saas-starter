import { getLocale, getUrlOrigin, localizeUrl } from '@b2b-saas-starter/i18n/runtime'

/** Private and protocol routes have no locale alternates. */
export function localeLinks(pathname: string) {
  const source = new URL(pathname, getUrlOrigin())
  const english = localizeUrl(source, { locale: 'en' })
  if (english.pathname === source.pathname) {
    return []
  }
  const norwegian = localizeUrl(source, { locale: 'nb' })
  // Existing technical articles are English, even inside the Norwegian shell.
  const englishArticle = /^\/(?:docs\/[^/]+\/[^/]+|blog\/[^/]+)\/?$/u.test(pathname)
  if (englishArticle) {
    return [{ rel: 'canonical', href: english.href }]
  }
  return [
    { rel: 'canonical', href: getLocale() === 'nb' ? norwegian.href : english.href },
    { rel: 'alternate', hrefLang: 'en', href: english.href },
    { rel: 'alternate', hrefLang: 'nb', href: norwegian.href },
    { rel: 'alternate', hrefLang: 'x-default', href: english.href }
  ]
}
