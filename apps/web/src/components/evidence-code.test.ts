import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { expect, it, vi } from 'vite-plus/test'
import { renderWorkspace } from '@/foldkit/workspace/test-harness'
import { demoFixtures } from '@/lib/demo-fixtures'

// Diagnostic bytes must be copied unaltered, stay selectable, render as code,
// expose wrapping state, and never announce success on clipboard refusal.
async function renderEvidence(text: string) {
  const endpoint = demoFixtures.webhooks.endpoints[0]
  const delivery = endpoint?.deliveries[0]
  if (!endpoint || !delivery) {
    throw new Error('Synthetic delivery fixture missing')
  }
  await renderWorkspace({
    _tag: 'webhooks',
    data: {
      ...demoFixtures.webhooks,
      endpoints: [{ ...endpoint, deliveries: [{ ...delivery, responseBody: text }] }]
    }
  })
  const evidence = screen.getByText(text).closest('details')
  if (!evidence) {
    throw new Error('Diagnostic disclosure missing')
  }
  evidence.open = true
  const parent = evidence.parentElement?.closest('details')
  if (parent) {
    parent.open = true
  }
  return within(evidence)
}

it('copies the original diagnostic text and announces success', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  })
  const evidence = await renderEvidence('{"name":"<script>"}')
  fireEvent.click(evidence.getByRole('button', { name: 'Copy Response body' }))
  await screen.findByText('Copied')
  expect(writeText).toHaveBeenCalledWith('{"name":"<script>"}')
  expect.soft(evidence.getByText('{"name":"<script>"}').tagName).toBe('CODE')
  const wrap = evidence.getByRole('button', { name: 'Wrap lines' })
  fireEvent.click(wrap)
  await waitFor(() => expect(wrap.getAttribute('aria-pressed')).toBe('false'))
})

it('keeps evidence selectable and reports clipboard refusal without claiming success', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) }
  })
  const evidence = await renderEvidence('Service unavailable')
  fireEvent.click(evidence.getByRole('button', { name: 'Copy Response body' }))
  await screen.findByText('Could not copy. Select the text to copy it manually.')
  expect(screen.queryByText('Copied')).toBeNull()
  expect(
    evidence.getByText('Service unavailable').closest('pre')?.getAttribute('tabindex')
  ).toBe('0')
})
