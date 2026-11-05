// oxlint-disable effect/noTestLifecycleHooks, effect/noGlobals -- the Vitest transport boundary must install and restore native fetch around every test
import { afterEach, beforeEach, vi } from 'vite-plus/test'

// This package owns its fetch transport. Explicit test transports may replace it;
// attempted real external requests remain failures even if recovery catches them.
const nativeFetch = globalThis.fetch
const attempts: Array<string> = []

beforeEach(() => {
  attempts.length = 0
  globalThis.fetch = function guardedFetch(input, init) {
    const url = requestUrl(input)
    if (!['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
      attempts.push(url.origin)
      return Promise.reject(new Error('Unexpected external network attempt'))
    }
    // Native redirect following would bypass this wrapper at the next hop.
    // Intentional redirect tests can inspect a manual response themselves.
    let redirect: RequestRedirect = 'error'
    if (init?.redirect === 'manual') {
      redirect = 'manual'
    }
    return nativeFetch(input, {
      ...init,
      redirect
    })
  }
})

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) {
    return new URL(input.url)
  }
  return new URL(input)
}

afterEach(() => {
  vi.unstubAllGlobals()
  globalThis.fetch = nativeFetch
  if (attempts.length > 0) {
    throw new Error(`Unexpected external network attempt: ${attempts.join(', ')}`)
  }
})
