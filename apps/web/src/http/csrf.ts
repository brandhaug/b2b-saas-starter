/** All application RPC uses JSON POSTs, including reads, with explicit client intent. */
export function csrfResponse(request: Request): Response | undefined {
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  if (
    (origin !== null && origin !== new URL(request.url).origin) ||
    (site !== null && site !== 'same-origin' && site !== 'none') ||
    request.headers.get('x-starter-client') !== '1' ||
    request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json'
  ) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  return undefined
}
