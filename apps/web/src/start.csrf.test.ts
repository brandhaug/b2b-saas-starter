import { describe, expect, it } from 'vite-plus/test'
import { csrfSymbol } from '@tanstack/react-start'

import { startInstance } from './start'

async function runCsrfMiddleware(
  request: Request,
  handlerType: 'serverFn' | 'router' = 'serverFn'
) {
  const options = await startInstance.getOptions()
  const middleware = options.requestMiddleware?.[3]
  if (!middleware) {
    throw new Error('configured CSRF middleware is missing')
  }
  if (!(csrfSymbol in middleware)) {
    throw new Error('request middleware order changed; expected CSRF at index 3')
  }

  const server = middleware.options.server
  if (!server) {
    throw new Error('configured CSRF middleware has no server handler')
  }

  const continued = new Response('next')
  try {
    const result = await server({
      request,
      pathname: new URL(request.url).pathname,
      context: undefined,
      handlerType,
      // A sentinel records continuation without constructing Start's generic context.
      next: () => {
        throw continued
      }
    })
    return result instanceof Response ? result : result.response
  } catch (error) {
    if (error === continued) {
      return continued
    }
    throw error
  }
}

describe('configured CSRF middleware', () => {
  it('allows same-origin server-function requests', async () => {
    const response = await runCsrfMiddleware(
      new Request('https://starter.example/_serverFn', {
        method: 'POST',
        headers: { Origin: 'https://starter.example' }
      })
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('next')
  })

  it.each<[string, RequestInit]>([
    [
      'cross-site POST',
      { method: 'POST', headers: { Origin: 'https://attacker.example' } }
    ],
    [
      'cross-site GET',
      { method: 'GET', headers: { Origin: 'https://attacker.example' } }
    ],
    ['missing request metadata', { method: 'POST' }]
  ])('%s server-function requests', async (_label, init) => {
    const response = await runCsrfMiddleware(
      new Request('https://starter.example/_serverFn', init)
    )

    expect(response.status).toBe(403)
    await expect(response.text()).resolves.toBe('Forbidden')
  })

  it('bypasses validation for router requests', async () => {
    const response = await runCsrfMiddleware(
      new Request('https://starter.example/workspaces/starter-lab', {
        method: 'POST',
        headers: { Origin: 'https://attacker.example' }
      }),
      'router'
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('next')
  })
})
