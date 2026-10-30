import { describe, expect, it } from 'vite-plus/test'
import { csrfResponse } from './http/csrf'

function runCsrfMiddleware(
  request: Request,
  handlerType: 'serverFn' | 'router' = 'serverFn'
) {
  return (
    (handlerType === 'serverFn' ? csrfResponse(request) : undefined) ??
    new Response('next')
  )
}

describe('application HTTP CSRF boundary', () => {
  it('allows same-origin application calls', async () => {
    const response = runCsrfMiddleware(
      new Request('https://starter.example/api/web/read', {
        method: 'POST',
        headers: {
          Origin: 'https://starter.example',
          'Content-Type': 'application/json',
          'X-Starter-Client': '1'
        }
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
  ])('refuses %s', async (_label, init) => {
    const response = runCsrfMiddleware(
      new Request('https://starter.example/api/web/read', init)
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('leaves document navigation outside the application-call CSRF boundary', async () => {
    const response = runCsrfMiddleware(
      new Request('https://starter.example/workspaces/starter-lab', {
        headers: { Origin: 'https://attacker.example' }
      }),
      'router'
    )
    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('next')
  })
})
