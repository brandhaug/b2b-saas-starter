import { AsyncLocalStorage } from 'node:async_hooks'

// Server-only. Browser clients import contracts, never this request authority.
type RequestContext = {
  readonly request: Request
  readonly cookies: Array<string>
}

const requests = new AsyncLocalStorage<RequestContext>()

export function currentRequest(): Request | undefined {
  return requests.getStore()?.request
}

export function withRequest<A>(request: Request, run: () => A): A {
  return requests.run({ request, cookies: [] }, run)
}

/** Keep each Set-Cookie verbatim; commas in Expires are not cookie separators. */
export function captureResponseCookies(headers: Headers): void {
  requests.getStore()?.cookies.push(...headers.getSetCookie())
}

/** Runs inside withRequest after success, redirect or sanitized failure assembly. */
export function applyResponseCookies(response: Response): Response {
  const cookies = requests.getStore()?.cookies
  if (!cookies?.length) {
    return response
  }
  // Passing the response as init also retains Workers' websocket upgrade metadata.
  const outgoing = new Response(response.body, response)
  const direct = response.headers.getSetCookie()
  outgoing.headers.delete('set-cookie')
  for (const cookie of [...cookies, ...direct]) {
    outgoing.headers.append('set-cookie', cookie)
  }
  return outgoing
}
