import { type init as sentryInit } from '@sentry/react'
import { type default as posthog, type PostHog } from 'posthog-js'
import { act, render, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vite-plus/test'
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
    sentryInit: vi.fn<typeof sentryInit>(),
    posthogInit: vi.fn<typeof posthog.init>()
  }
})

vi.mock('@sentry/react', async () => {
  await providers.sentryDownload
  return { getClient: () => undefined, init: providers.sentryInit }
})

vi.mock('posthog-js', () => ({
  default: { __loaded: false, init: providers.posthogInit }
}))

it('starts analytics while error reporting downloads and cancels initialization on unmount', async () => {
  const { rerender, unmount } = render(
    <ClientTelemetry
      config={{ sentryDsn: undefined, posthogKey: undefined, posthogHost: undefined }}
    />
  )
  await act(async () => {})
  expect(providers.posthogInit).not.toHaveBeenCalled()
  expect(providers.sentryInit).not.toHaveBeenCalled()

  rerender(
    <ClientTelemetry
      config={{
        sentryDsn: 'https://public@example.com/1',
        posthogKey: 'public-key',
        posthogHost: undefined
      }}
    />
  )
  await waitFor(() => expect(providers.posthogInit).toHaveBeenCalledTimes(1))
  expect(providers.sentryInit).not.toHaveBeenCalled()

  unmount()
  await act(async () => {
    providers.finishDownload()
    await vi.dynamicImportSettled()
  })
  expect(providers.sentryInit).not.toHaveBeenCalled()
})

it('AC-9.1/2/3 emits minimal page analytics and scrubs browser error reports', async () => {
  const { unmount } = render(
    <ClientTelemetry
      config={{
        sentryDsn: 'https://public@example.com/1',
        posthogKey: 'public-key',
        posthogHost: undefined
      }}
    />
  )
  await waitFor(() => expect(providers.sentryInit).toHaveBeenCalledTimes(1))
  const sentryOptions = providers.sentryInit.mock.calls[0]?.[0]
  const posthogOptions = providers.posthogInit.mock.calls.at(-1)?.[1]
  expect(sentryOptions).toBeDefined()
  expect(posthogOptions).toBeDefined()
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
  const payloads: Array<string> = []
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    payloads.push(await new Response(init?.body).text())
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  const actual = await vi.importActual<{ PostHog: typeof PostHog }>('posthog-js')
  const analytics = new actual.PostHog()
  try {
    analytics.init('public-key', {
      ...posthogOptions,
      api_transport: 'fetch',
      request_batching: false,
      disable_compression: true
    })
    analytics.capture(
      '$pageview',
      {
        $current_url: `https://app.example?token=${secret}`,
        email: secret,
        $set: { name: secret }
      },
      { send_instantly: true }
    )
    analytics.capture(
      '$pageleave',
      { $referrer: `https://example.com/${secret}`, $elements: [secret] },
      { send_instantly: true }
    )
    analytics.capture('customer-content', { content: secret }, { send_instantly: true })
    await waitFor(() => expect(payloads.length).toBeGreaterThanOrEqual(2))
    expect(payloads.join('')).not.toContain(secret)
    expect(payloads.join('')).not.toContain('customer-content')
    expect(payloads.join('')).not.toContain('$current_url')
    expect(payloads.join('')).toContain('$pageview')
    expect(payloads.join('')).toContain('$pageleave')
    expect(payloads.join('')).toContain('distinct_id')
  } finally {
    analytics.opt_out_capturing()
    vi.unstubAllGlobals()
  }
  unmount()
})
