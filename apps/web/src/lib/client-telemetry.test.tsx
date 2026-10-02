import { type default as posthog, type PostHog } from 'posthog-js'
import { act, render, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vite-plus/test'
import { ClientTelemetry } from './client-telemetry'

const providers = vi.hoisted(() => ({ posthogInit: vi.fn<typeof posthog.init>() }))

vi.mock('posthog-js', () => ({
  default: { __loaded: false, init: providers.posthogInit }
}))

it('leaves unconfigured browser analytics inactive', async () => {
  const { unmount } = render(
    <ClientTelemetry config={{ posthogKey: undefined, posthogHost: undefined }} />
  )
  await act(async () => {})
  expect(providers.posthogInit).not.toHaveBeenCalled()
  unmount()
})

it('emits minimal page analytics', async () => {
  const { unmount } = render(
    <ClientTelemetry
      config={{
        posthogKey: 'public-key',
        posthogHost: undefined
      }}
    />
  )
  await waitFor(() => expect(providers.posthogInit).toHaveBeenCalled())
  const posthogOptions = providers.posthogInit.mock.calls.at(-1)?.[1]
  expect(posthogOptions).toBeDefined()
  const secret = 'BROWSER_SENSITIVE_SENTINEL'
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
