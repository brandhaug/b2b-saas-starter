import { describe, expect, it } from 'vite-plus/test'
import { currentRequest, withRequest } from '../lib/request-context'
import { csrfResponse } from './csrf'
import { publicFailure } from './errors'
import { UiError } from '../lib/ui-error'

describe('Fetch request boundary', () => {
  it('isolates asynchronous requests and restores the outer context', async () => {
    const first = new Request('https://app.test/first')
    const second = new Request('https://app.test/second')
    const results = await Promise.all(
      [first, second].map((request) =>
        withRequest(request, async () => {
          await Promise.resolve()
          return currentRequest()?.url
        })
      )
    )
    expect(results).toEqual([first.url, second.url])
    expect(currentRequest()).toBeUndefined()
  })

  it('rejects cross-origin and opaque origins even with the client header', () => {
    for (const origin of ['https://evil.test', 'null']) {
      expect(
        csrfResponse(
          new Request('https://app.test/api/web/read', {
            method: 'POST',
            headers: {
              origin,
              'x-starter-client': '1',
              'content-type': 'application/json'
            }
          })
        )?.status
      ).toBe(403)
    }
  })

  it('requires same-origin JSON client intent for requests without Origin', () => {
    expect(
      csrfResponse(new Request('https://app.test/api/web/read', { method: 'POST' }))
        ?.status
    ).toBe(403)
    expect(
      csrfResponse(
        new Request('https://app.test/api/web/read', {
          method: 'POST',
          headers: { 'x-starter-client': '1', 'content-type': 'application/json' }
        })
      )
    ).toBeUndefined()
    expect(
      csrfResponse(
        new Request('https://app.test/api/web/read', {
          method: 'POST',
          headers: {
            'x-starter-client': '1',
            'content-type': 'application/json',
            'sec-fetch-site': 'cross-site'
          }
        })
      )?.status
    ).toBe(403)
  })

  it('sanitizes unexpected failures and preserves public refusal codes', () => {
    expect(JSON.stringify(publicFailure(new Error('password=secret')))).not.toContain(
      'secret'
    )
    expect(
      publicFailure(new UiError('unauthorized', {}, 'private diagnostic')).code
    ).toBe('unauthorized')
    expect(
      JSON.stringify(
        publicFailure(new UiError('unauthorized', {}, 'private diagnostic'))
      )
    ).not.toContain('diagnostic')
  })
})
