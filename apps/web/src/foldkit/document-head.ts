import { localizeUrl } from '@b2b-saas-starter/i18n/runtime'
import { m } from '@b2b-saas-starter/i18n/messages'
import geist from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url'
import geistMono from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url'
import newsreader from '@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2?url'
import { type Flags } from './program'
import { initialModel } from './auth/model'
import { copy } from './auth/view'

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
function description(flags: Flags): string {
  if (flags.page._tag === 'Auth') {
    return copy(initialModel(flags.page.flags)).description
  }
  if (flags.page._tag === 'Public') {
    const page = flags.page.flags.page
    switch (page._tag) {
      case 'Error': {
        return m.shell_description()
      }
      case 'Home': {
        return m.landing_description()
      }
      case 'Pricing': {
        return m.public_pricing_description()
      }
      case 'Help': {
        return m.support_description()
      }
      case 'Legal': {
        return page.page === 'privacy'
          ? m.public_legal_privacy_description()
          : m.public_legal_terms_description()
      }
      case 'Docs': {
        return page.flags._tag === 'Article'
          ? page.flags.meta.frontmatter.description
          : m.docs_search_language()
      }
    }
  }
  return m.shell_description()
}

/** Extra head HTML for the Foldkit document renderer; titles/canonical remain Document-owned. */
export function documentHead(flags: Flags): string {
  const summary = description(flags)
  const article =
    flags.page._tag === 'Public' &&
    flags.page.flags.page._tag === 'Docs' &&
    flags.page.flags.page.flags._tag === 'Article'
      ? flags.page.flags.page.flags
      : null
  const metas = [
    ['name', 'description', summary],
    ['property', 'og:type', article ? 'article' : 'website'],
    ['property', 'og:site_name', 'B2B SaaS Starter'],
    ['property', 'og:title', flags.title],
    ['property', 'og:description', summary],
    ['name', 'twitter:card', 'summary'],
    ['name', 'twitter:title', flags.title],
    ['name', 'twitter:description', summary]
  ]
  if (article?.meta.frontmatter.tags?.length) {
    metas.push(['name', 'keywords', article.meta.frontmatter.tags.join(', ')])
  }
  if (flags.page._tag === 'Public' && flags.page.flags.page._tag === 'Home') {
    metas.push(['name', 'deployment-page', 'public-home'])
  }
  const metadata = metas
    .map(
      ([attribute, key, value]) =>
        `<meta ${attribute}="${escape(key ?? '')}" content="${escape(value ?? '')}">`
    )
    .join('')
  const fonts = [
    geist,
    geistMono,
    ...(flags.page._tag === 'Public' ? [newsreader] : [])
  ]
    .map(
      (href) =>
        `<link rel="preload" href="${escape(href)}" as="font" type="font/woff2" crossorigin="anonymous">`
    )
    .join('')
  let alternates = ''
  if (flags.canonical !== null && article === null) {
    const english = localizeUrl(new URL(flags.canonical), { locale: 'en' })
    const norwegian = localizeUrl(new URL(flags.canonical), { locale: 'nb' })
    if (english.pathname !== norwegian.pathname) {
      alternates = [
        ['en', english.href],
        ['nb', norwegian.href],
        ['x-default', english.href]
      ]
        .map(
          ([locale, href]) =>
            `<link rel="alternate" hreflang="${locale}" href="${escape(href ?? '')}">`
        )
        .join('')
    }
  }
  return metadata + fonts + alternates
}
