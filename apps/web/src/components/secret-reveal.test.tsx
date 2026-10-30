import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vite-plus/test'
import { SecretReveal } from './secret-reveal'

it('hides a replacement secret and resets copy feedback without moving focus', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) }
  })
  const view = render(<SecretReveal secret="first_secret" label="Token" />)
  const show = screen.getByRole('button', { name: 'Show Token' })
  show.focus()
  fireEvent.click(show)
  fireEvent.click(screen.getByRole('button', { name: 'Copy Token' }))
  await screen.findByText('Copied')
  const output = screen.getByRole('status')
  view.rerender(<SecretReveal secret="second_secret" label="Token" />)
  expect(screen.queryByText('second_secret')).toBeNull()
  expect(screen.queryByText('Copied')).toBeNull()
  expect(screen.getByRole('button', { name: 'Show Token' })).toBe(show)
  expect(document.activeElement).toBe(show)
  expect(screen.getByRole('status')).toBe(output)
})

it('announces clipboard refusal and leaves the secret available for manual selection', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('denied'))
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  })

  render(<SecretReveal secret="whsec_manual_recovery" label="Webhook secret" />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy Webhook secret' }))

  await waitFor(() =>
    expect(
      screen.getByText('Could not copy. Show the secret and select it manually.')
    ).not.toBeNull()
  )
  expect(writeText).toHaveBeenCalledWith('whsec_manual_recovery')
  expect(screen.queryByText('Copied')).toBeNull()
  expect(screen.getByText('whs…very')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Show Webhook secret' }))
  expect(screen.getByText('whsec_manual_recovery')).not.toBeNull()
})
