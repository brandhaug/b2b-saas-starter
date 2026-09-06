import { AccountPreferencesService } from '@b2b-saas-starter/capabilities/governance/account-preferences'
import { paraglideMiddleware } from '@b2b-saas-starter/i18n/server'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import { DEFAULT_LOCALE, localeFromLanguage } from '@b2b-saas-starter/i18n/locale'
import routeConfig from '@b2b-saas-starter/i18n/routes'
import { Effect } from 'effect'
import { runCapabilities } from '../capabilities'
import { readOptionalSession } from './auth'
import { withPresentation } from './i18n-context'

function isUnlocalizedPath(pathname: string): boolean {
  return (
    routeConfig.unlocalizedPaths.some((path) => isPathOrDescendant(pathname, path)) ||
    routeConfig.unlocalizedExactPaths.includes(pathname)
  )
}

function isPathOrDescendant(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`)
}

function needsAccountPresentation(pathname: string): boolean {
  return routeConfig.accountPresentationPaths.some((path) =>
    isPathOrDescendant(pathname, path)
  )
}

/** Auth/API callbacks keep their original request body, headers, and URL. */
export async function localizeRequest(
  request: Request,
  next: () => Promise<Response>
): Promise<Response> {
  const pathname = new URL(request.url).pathname
  if (isUnlocalizedPath(pathname)) {
    return next()
  }

  const session = needsAccountPresentation(pathname)
    ? await readOptionalSession()
    : null
  const preferences = session
    ? await runCapabilities(
        Effect.flatMap(AccountPreferencesService, (service) =>
          service.get(session.user.id)
        )
      )
    : { locale: null, timeZone: null }
  const headers = new Headers(request.headers)
  const cookie = headers.get('cookie') ?? ''
  // Normalize the Norwegian browser alias before Paraglide's locale matching.
  headers.set('accept-language', localeFromLanguage(headers.get('accept-language')))
  const accountLocale = session ? (preferences.locale ?? DEFAULT_LOCALE) : null
  if (accountLocale) {
    const otherCookies = cookie
      .split(';')
      .filter((part) => !part.trim().startsWith('starter_locale='))
      .join(';')
    headers.set('cookie', `${otherCookies}; starter_locale=${accountLocale}`)
  }
  const detectionRequest = new Request(request.url, { headers, method: request.method })
  return paraglideMiddleware(detectionRequest, () =>
    withPresentation(
      {
        timeZone: preferences.timeZone ?? 'UTC',
        authenticated: session !== null,
        needsTimeZone: session !== null && preferences.timeZone === null
      },
      async () => {
        const original = await next()
        const response = new Response(original.body, {
          status: original.status,
          statusText: original.statusText,
          headers: new Headers(original.headers)
        })
        response.headers.set('Content-Language', getLocale())
        response.headers.append('Vary', 'Cookie, Accept-Language')
        // The HTML locale is also serialized for hydration. The cookie carries it
        // to later client navigations and server-function requests.
        response.headers.append(
          'Set-Cookie',
          `starter_locale=${getLocale()}; Path=/; Max-Age=31536000; SameSite=Lax${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`
        )
        if (session) {
          response.headers.set('Cache-Control', 'private, no-store')
        }
        return response
      }
    )
  )
}
