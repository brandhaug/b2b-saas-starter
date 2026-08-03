/** Map Public Site Booking traffic to the Vite paths it can serve locally. */
export const bookingProxyRequest = async (
  request: Request,
  target: URL
): Promise<Request> => {
  const mutation = request.method !== 'GET' && request.method !== 'HEAD'
  return new Request(target, {
    method: request.method,
    headers: request.headers,
    redirect: 'manual',
    ...(mutation ? { body: await request.arrayBuffer() } : {})
  })
}

export const bookingVitePath = (pathname: string): string => {
  // StyleX's development stylesheet is the one Vite virtual endpoint that
  // ignores Vite's `base`. Keep the browser URL under Booking's public asset
  // prefix, then remove it only on this private Vite hop.
  if (
    pathname === '/_booking/virtual:stylex.css' ||
    pathname === '/virtual:stylex.css'
  ) {
    return '/virtual:stylex.css'
  }
  return pathname
}
