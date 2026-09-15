import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vite-plus/test'
import { SecretReveal } from './secret-reveal'

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
