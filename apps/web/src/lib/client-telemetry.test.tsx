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
    sentryInit: vi.fn(),
    posthogInit: vi.fn()
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
