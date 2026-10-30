import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithRouter } from '@/test/router-harness'
import { expect, it, vi } from 'vite-plus/test'
import { WebhookForm, type CreateWebhookEndpoint } from './webhook-form'

it('retries only refresh after the endpoint was created', async () => {
  const createEndpoint = vi.fn<CreateWebhookEndpoint>(async () => ({
    endpoint: {
      id: 'whe_new',
      url: 'https://example.test/hooks',
      enabled: true,
      events: ['api_token.created'],
      successRate: 0
    },
    signingSecret: 'whsec_once'
  }))
  const onCreated = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined)
  await renderWithRouter(
    <WebhookForm
      workspaceSlug="starter-lab"
      createEndpoint={createEndpoint}
      onCreated={onCreated}
    />
  )
  fireEvent.change(screen.getByLabelText('Endpoint URL'), {
    target: { value: 'https://example.test/hooks' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create endpoint' }))
  await screen.findByText('whsec_once')
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(2))
  expect(createEndpoint).toHaveBeenCalledTimes(1)
})
