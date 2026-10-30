import { fireEvent, screen, within } from '@testing-library/dom'
import { expect, it, vi } from 'vite-plus/test'
import { renderWorkspace } from '@/foldkit/workspace/test-harness'
import { demoFixtures } from '@/lib/demo-fixtures'

// Preserve hidden initial value, exact copy bytes, denial guidance, manual reveal.
it('announces clipboard refusal and leaves the secret available for manual selection', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('Denied'))
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  })
  await renderWorkspace(
    { _tag: 'webhooks', data: demoFixtures.webhooks },
    { model: (model) => ({ ...model, secret: 'whsec_manual_recovery' }) }
  )
  expect(screen.queryByText('whsec_manual_recovery')).toBeNull()
  const section = screen.getByRole('button', { name: /^Show / }).closest('section')
  if (!section) {
    throw new Error('Secret section missing')
  }
  fireEvent.click(within(section).getByRole('button', { name: 'Copy Webhook secret' }))
  await screen.findByText('Could not copy. Show the secret and select it manually.')
  expect(writeText).toHaveBeenCalledWith('whsec_manual_recovery')
  expect(screen.queryByText('Copied')).toBeNull()
  expect(screen.getByText('whs…very')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Show Webhook secret' }))
  expect(await screen.findByText('whsec_manual_recovery')).toBeDefined()
})
