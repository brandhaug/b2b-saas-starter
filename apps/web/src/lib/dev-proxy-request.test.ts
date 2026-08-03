import { expect, it } from 'vitest'
import { bufferedDevProxyRequest } from './dev-proxy-request.ts'

it('buffers mutation bodies before forwarding them to Booking', async () => {
  const forwarded = await bufferedDevProxyRequest(
    new Request('http://localhost:3071/adda/booking/session/bsn_one/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ primaryServiceId: 'svc_one' })
    }),
    new URL('http://localhost:3073/adda/booking/session/bsn_one/services')
  )

  expect(forwarded.redirect).toBe('manual')
  await expect(forwarded.json()).resolves.toEqual({
    primaryServiceId: 'svc_one'
  })
})
