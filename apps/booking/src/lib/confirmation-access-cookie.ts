export const confirmationCookieName = (routeId: string): string =>
  `confirmation_${routeId}`

export const readCookieValue = (
  cookieHeader: string | null | undefined,
  name: string
): string | undefined =>
  cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)

export const readConfirmationCookie = (
  request: Request,
  routeId: string
): string | undefined =>
  readCookieValue(request.headers.get('cookie'), confirmationCookieName(routeId))
