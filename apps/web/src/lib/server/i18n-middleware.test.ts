import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import { localizeRequest } from './i18n-middleware'
import { requestPresentation } from './i18n-context'

const state = vi.hoisted(() => ({
  signedIn: false,
  databaseUnavailable: false,
  preferences: { locale: 'en', timeZone: 'America/New_York' }
}))

vi.mock('./auth', () => ({
  readOptionalSession: () => {
    if (state.databaseUnavailable) {
      throw new Error('D1 unavailable')
    }
    return state.signedIn ? { user: { id: 'usr_demo' } } : null
  }
}))
vi.mock('../capabilities', () => ({
  runCapabilities: () => state.preferences
}))

beforeEach(() => {
  state.signedIn = false
  state.databaseUnavailable = false
})

async function renderPresentation() {
  return new Response(JSON.stringify({ locale: getLocale(), ...requestPresentation() }))
}

describe('locale request integration', () => {
  it.each(['/demo', '/demo/billing'])(
    'uses guest presentation for %s even with a signed-in cookie and unavailable database',
    async (path) => {
      state.signedIn = true
      state.databaseUnavailable = true
      const response = await localizeRequest(
        new Request(`https://starter.test${path}`, {
          headers: {
            cookie: 'better-auth.session_token=unavailable-session; starter_locale=nb'
          }
        }),
        renderPresentation
      )
      expect(await response.json()).toMatchObject({
        locale: 'nb',
        timeZone: 'UTC',
        authenticated: false,
        needsTimeZone: false
      })
    }
  )

  it.each(['/help', '/help/', '/nb/help', '/api/support-config'])(
    'public support %s stays reachable with a session cookie and unavailable D1',
    async (path) => {
      state.signedIn = true
      state.databaseUnavailable = true
      const response = await localizeRequest(
        new Request(`https://starter.test${path}`, {
          headers: { cookie: 'better-auth.session_token=unavailable-session' }
        }),
        async () => new Response('support is available')
      )
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('support is available')
    }
  )

  it('uses the account preference on an unprefixed app route', async () => {
    state.signedIn = true
    const response = await localizeRequest(
      new Request('https://starter.test/account', {
        headers: { accept: 'text/html', cookie: 'starter_locale=nb' }
      }),
      renderPresentation
    )
    expect(await response.json()).toMatchObject({
      locale: 'en',
      timeZone: 'America/New_York',
      authenticated: true
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('honors an explicit public language URL even for a signed-in account', async () => {
    state.signedIn = true
    const response = await localizeRequest(
      new Request('https://starter.test/nb/pricing', {
        headers: { accept: 'text/html' }
      }),
      renderPresentation
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ locale: 'nb' })
  })

  it('detects Bokmål for a guest and keeps anonymous timestamps in UTC', async () => {
    const response = await localizeRequest(
      new Request('https://starter.test/sign-in', {
        headers: { accept: 'text/html', 'accept-language': 'no-NO,en;q=0.5' }
      }),
      renderPresentation
    )
    expect(await response.json()).toMatchObject({
      locale: 'nb',
      timeZone: 'UTC',
      authenticated: false
    })
    expect(response.headers.get('set-cookie')).toContain('starter_locale=nb')
  })

  it('leaves authentication API callbacks untouched', async () => {
    const response = await localizeRequest(
      new Request('https://starter.test/api/auth/callback/github'),
      async () => new Response('callback')
    )
    expect(await response.text()).toBe('callback')
    expect(response.headers.has('set-cookie')).toBe(false)
  })

  it.each(['/assets/app.123.js', '/favicon.svg', '/llms-full.txt', '/robots.txt'])(
    'leaves static asset %s untouched',
    async (path) => {
      const response = await localizeRequest(
        new Request(`https://starter.test${path}`, {
          headers: { 'accept-language': 'nb-NO' }
        }),
        async () => new Response('asset')
      )
      expect(await response.text()).toBe('asset')
      expect(response.headers.has('content-language')).toBe(false)
      expect(response.headers.has('set-cookie')).toBe(false)
    }
  )
})
