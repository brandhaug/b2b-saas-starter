/* oxlint-disable effect/noAsyncFunction -- middleware tests exercise async request isolation */
import { describe, expect, it } from 'vite-plus/test'
import {
  deLocalizeUrl,
  getLocale,
  localizeHref,
  localizeUrl,
  routeStrategies
} from './runtime.ts'
import { paraglideMiddleware } from './server.ts'

describe('localized public URLs', () => {
  it('prefixes both supported locales and preserves query and hash values', () => {
    expect(localizeHref('/pricing?plan=team#compare', { locale: 'en' })).toBe(
      '/en/pricing?plan=team#compare'
    )
    expect(
      localizeUrl('https://starter.test/pricing?plan=team#compare', { locale: 'nb' })
        .href
    ).toBe('https://starter.test/nb/pricing?plan=team#compare')
    expect(
      deLocalizeUrl('https://starter.test/nb/pricing?plan=team#compare').href
    ).toBe('https://starter.test/pricing?plan=team#compare')
  })

  it('leaves private and transport URLs unprefixed', () => {
    expect(localizeHref('/account?tab=security#passkeys', { locale: 'nb' })).toBe(
      '/account?tab=security#passkeys'
    )
    expect(localizeHref('/api/workspaces?limit=10', { locale: 'nb' })).toBe(
      '/api/workspaces?limit=10'
    )
    expect(
      localizeHref('/.well-known/oauth-authorization-server', { locale: 'nb' })
    ).toBe('/.well-known/oauth-authorization-server')
  })

  it('excludes known static assets without treating dotted public slugs as assets', () => {
    for (const path of ['/assets/app.123.js', '/favicon.svg', '/robots.txt']) {
      expect(localizeHref(path, { locale: 'nb' })).toBe(path)
    }
    expect(localizeHref('/blog/release.v2', { locale: 'nb' })).toBe(
      '/nb/blog/release.v2'
    )

    for (const path of ['/assets/:path(.*)?', '/favicon.svg', '/robots.txt']) {
      expect(routeStrategies).toContainEqual({ match: path, exclude: true })
    }
  })
})

describe('server locale isolation', () => {
  it('redirects the root document to the English public prefix', async () => {
    const response = await paraglideMiddleware(
      new Request('https://starter.test/', {
        headers: { 'Sec-Fetch-Dest': 'document' }
      }),
      () => new Response('unreachable')
    )
    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toBe('https://starter.test/en')
  })

  it('keeps concurrent public requests in their own locale context', async () => {
    async function resolve() {
      await new Promise<void>((_resolve) => {
        _resolve()
      })
      return new Response(getLocale())
    }
    const [english, norwegian] = await Promise.all([
      paraglideMiddleware(new Request('https://starter.test/en/pricing'), resolve),
      paraglideMiddleware(new Request('https://starter.test/nb/pricing'), resolve)
    ])
    expect(await english.text()).toBe('en')
    expect(await norwegian.text()).toBe('nb')
  })
})
