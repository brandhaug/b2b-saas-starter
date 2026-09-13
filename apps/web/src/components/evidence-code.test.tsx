import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vite-plus/test'
import { EvidenceCode } from './evidence-code'

it('copies the original diagnostic text and announces success', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  })
  render(<EvidenceCode label="Payload" value='{"name":"<script>"}' />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy Payload' }))
  await screen.findByText('Copied')
  expect(writeText).toHaveBeenCalledWith('{"name":"<script>"}')
  expect(screen.getByText('{"name":"<script>"}').tagName).toBe('CODE')
  const wrapping = screen.getByRole('button', { name: 'Wrap lines' })
  fireEvent.click(wrapping)
  expect(wrapping.getAttribute('aria-pressed')).toBe('false')
})

it('keeps evidence selectable and reports clipboard refusal without claiming success', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) }
  })
  render(<EvidenceCode label="Response" value="Service unavailable" />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy Response' }))
  await screen.findByText('Could not copy. Select the text to copy it manually.')
  expect(screen.queryByText('Copied')).toBeNull()
  expect(
    screen.getByText('Service unavailable').closest('pre')?.getAttribute('tabindex')
  ).toBe('0')
})
