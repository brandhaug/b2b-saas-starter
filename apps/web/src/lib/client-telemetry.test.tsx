import { type init as sentryInit } from '@sentry/react'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { ClientTelemetry } from './client-telemetry'

const providers = vi.hoisted(() => {
  let finishDownload: (() => void) | undefined
  const sentryDownload = new Promise<void>((resolve) => {
    finishDownload = resolve
  })
  if (finishDownload === undefined) {
    throw new Error('Promise executor did not run synchronously')
  }
  return {
    sentryDownload,
    finishDownload,
    sentryInit: vi.fn<typeof sentryInit>()
  }
})

vi.mock('@sentry/react', async () => {
  await providers.sentryDownload
  return { getClient: () => undefined, init: providers.sentryInit }
})

// The component subscribes to the router to re-send `$pageview` per
// client-side navigation; a router tree would add nothing to these cases.
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ subscribe: () => () => undefined })
}))

type Payload = { readonly url: string; readonly body: unknown }

function captureRequests(): Array<Payload> {
  const payloads: Array<Payload> = []
  const stub = vi.fn(async (url: string, init?: RequestInit) => {
    const body: unknown = JSON.parse(await new Response(init?.body).text())
    payloads.push({ url, body })
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', stub)
  return payloads
}

/** jsdom has no `sendBeacon`, so the beacon path is installed per test. */
function stubSendBeacon(sendBeacon: (url: string, body?: BodyInit) => boolean) {
  Object.defineProperty(navigator, 'sendBeacon', {
    value: sendBeacon,
    configurable: true
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'sendBeacon')
})

it('stays silent while both providers are unconfigured', async () => {
  const payloads = captureRequests()
  const { unmount } = render(
    <ClientTelemetry
      config={{ sentryDsn: undefined, posthogKey: undefined, posthogHost: undefined }}
    />
  )
  await act(async () => {})
  unmount()
  expect(payloads).toHaveLength(0)
  expect(providers.sentryInit).not.toHaveBeenCalled()
})

it('posts one pageview per view and a pageleave when the view ends', async () => {
  const payloads = captureRequests()
  const { unmount } = render(
    <ClientTelemetry
      config={{
        sentryDsn: undefined,
        posthogKey: 'public-key',
        posthogHost: 'https://analytics.example'
      }}
    />
  )
  await waitFor(() => expect(payloads).toHaveLength(1))
  expect(payloads[0]?.url).toBe('https://analytics.example/i/v0/e/')
  expect(payloads[0]?.body).toMatchObject({
    api_key: 'public-key',
    event: '$pageview',
    properties: { $process_person_profile: false }
  })
  expect(payloads[0]?.body).toHaveProperty('distinct_id')
  expect(JSON.stringify(payloads[0]?.body)).not.toContain('/docs')

  unmount()
  await waitFor(() => expect(payloads).toHaveLength(2))
  expect(payloads[1]?.body).toMatchObject({ event: '$pageleave' })
})

it('prefers a beacon so the unload event survives', async () => {
  const payloads = captureRequests()
  const sendBeacon = vi.fn((_url: string, _body?: BodyInit) => true)
  stubSendBeacon(sendBeacon)
  const { unmount } = render(
    <ClientTelemetry
      config={{
        sentryDsn: undefined,
        posthogKey: 'public-key',
        posthogHost: undefined
      }}
    />
  )
  await waitFor(() => expect(sendBeacon).toHaveBeenCalledTimes(1))
  expect(sendBeacon.mock.calls[0]?.[0]).toBe('https://us.i.posthog.com/i/v0/e/')
  unmount()
  expect(payloads).toHaveLength(0)
})

it('scrubs browser error reports', async () => {
  const { unmount } = render(
    <ClientTelemetry
      config={{
        sentryDsn: 'https://public@example.com/1',
        posthogKey: undefined,
        posthogHost: undefined
      }}
    />
  )
  await act(async () => {
    providers.finishDownload()
    await vi.dynamicImportSettled()
  })
  await waitFor(() => expect(providers.sentryInit).toHaveBeenCalledTimes(1))
  const sentryOptions = providers.sentryInit.mock.calls[0]?.[0]
  expect(sentryOptions).toBeDefined()
  const secret = 'BROWSER_SENSITIVE_SENTINEL'
  const output = sentryOptions?.beforeSend?.(
    {
      type: undefined,
      message: secret,
      request: {
        url: `https://app.example?token=${secret}`,
        cookies: { session: secret }
      },
      user: { email: `${secret}@example.com` },
      breadcrumbs: [{ message: secret }],
      exception: { values: [{ type: 'TypeError', value: secret }] }
    },
    {}
  )
  expect(JSON.stringify(output)).not.toContain(secret)
  expect(JSON.stringify(output)).toContain('TypeError')
  unmount()
})
