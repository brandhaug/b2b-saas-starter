import { act, render, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vite-plus/test'
import { TurnstileWidget } from './turnstile-widget'

it('replaces a failed script when a later widget mounts', async () => {
  const onToken = vi.fn()
  const first = render(<TurnstileWidget siteKey="key" onToken={onToken} />)
  const failed = document.getElementById('cf-turnstile-script')
  expect(failed).not.toBeNull()
  await act(async () => {
    failed?.dispatchEvent(new Event('error'))
  })
  first.unmount()
  render(<TurnstileWidget siteKey="key" onToken={onToken} />)
  await waitFor(() => {
    expect(document.getElementById('cf-turnstile-script')).not.toBeNull()
    expect(document.getElementById('cf-turnstile-script')).not.toBe(failed)
  })
})
