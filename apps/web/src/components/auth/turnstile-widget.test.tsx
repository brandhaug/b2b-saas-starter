import { act, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { TurnstileWidget } from './turnstile-widget'
import { type TurnstileProps } from '@marsidev/react-turnstile'

type WidgetCallbacks = {
  callback?: TurnstileProps['onSuccess']
  'expired-callback'?: TurnstileProps['onExpire']
  'error-callback'?: TurnstileProps['onError']
}

afterEach(() => vi.unstubAllGlobals())

it('retries a failed script on remount and never renders a widget unmounted before load', async () => {
  const onToken = vi.fn()
  const first = render(<TurnstileWidget siteKey="key" onToken={onToken} />)
  const failed = document.getElementById('cf-turnstile-script')
  expect(failed).not.toBeNull()
  await act(async () => {
    failed?.dispatchEvent(new Event('error'))
  })
  expect(onToken).toHaveBeenCalledWith(null)
  first.unmount()

  const abandoned = vi.fn()
  const second = render(<TurnstileWidget siteKey="key" onToken={abandoned} />)
  await waitFor(() => {
    expect(document.getElementById('cf-turnstile-script')).not.toBeNull()
    expect(document.getElementById('cf-turnstile-script')).not.toBe(failed)
  })
  const replacement = document.getElementById('cf-turnstile-script')
  expect(
    document.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile"]')
  ).toHaveLength(1)
  second.unmount()
  const api = { render: vi.fn(() => 'recovered'), remove: vi.fn() }
  vi.stubGlobal('turnstile', api)
  await act(async () => {
    replacement?.dispatchEvent(new Event('load'))
  })
  expect(api.render).not.toHaveBeenCalled()
  expect(abandoned).not.toHaveBeenCalled()

  const third = render(<TurnstileWidget siteKey="key" onToken={onToken} />)
  await waitFor(() => expect(api.render).toHaveBeenCalledOnce())
  expect(document.getElementById('cf-turnstile-script')).toBe(replacement)
  third.unmount()
  expect(api.remove).toHaveBeenCalledWith('recovered')
})

it('forwards tokens to the latest callback, clears expiry/errors, resets and removes the widget', async () => {
  let callbacks: WidgetCallbacks = {}
  const api = {
    render: vi.fn((_container, options) => {
      callbacks = options
      return 'widget-1'
    }),
    reset: vi.fn(),
    remove: vi.fn(),
    getResponse: vi.fn(),
    isExpired: vi.fn(() => false)
  }
  vi.stubGlobal('turnstile', api)
  const first = vi.fn()
  const latest = vi.fn()
  const view = render(<TurnstileWidget siteKey="key" onToken={first} />)
  await waitFor(() => expect(api.render).toHaveBeenCalledOnce())
  act(() => callbacks.callback?.('token-1'))
  expect(first).toHaveBeenLastCalledWith('token-1')
  view.rerender(<TurnstileWidget siteKey="key" onToken={latest} />)
  act(() => callbacks.callback?.('token-2'))
  expect(latest).toHaveBeenLastCalledWith('token-2')
  act(() => callbacks['expired-callback']?.('token-2'))
  expect(latest).toHaveBeenLastCalledWith(null)
  act(() => callbacks.callback?.('token-3'))
  act(() => callbacks['error-callback']?.('error'))
  expect(latest).toHaveBeenLastCalledWith(null)
  expect(api.reset).not.toHaveBeenCalled()
  view.rerender(<TurnstileWidget siteKey="key" onToken={latest} resetKey={1} />)
  expect(api.reset).toHaveBeenCalledWith('widget-1')
  expect(api.render).toHaveBeenCalledOnce()
  view.unmount()
  expect(api.remove).toHaveBeenCalledWith('widget-1')
})
