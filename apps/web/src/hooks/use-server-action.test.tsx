import { Button } from '@/components/ui/button'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { UiError } from '@/lib/ui-error'
import { unwrapAuthResult } from '@/lib/auth-result'
import { useServerAction } from './use-server-action'
import { PreviewProvider } from '@/components/preview-provider'
import { ActionFeedback } from '@/components/page/action-feedback'

function SensitiveAction({ run }: { readonly run: () => Promise<void> }) {
  const action = useServerAction(run, { failureMessage: 'Action failed' })
  return (
    <>
      <Button type="button" onClick={() => action.run()}>
        Delete workspace
      </Button>
      <ActionFeedback error={action.error} />
    </>
  )
}

describe('recent authentication return flow', () => {
  it('returns a denied action to verification and requires a deliberate retry after returning', async () => {
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(
        new UiError('strong_authentication_required', {}, 'verify')
      )
      .mockResolvedValue(undefined)
    const { router } = await renderWithRouter(<SensitiveAction run={run} />, {
      path: '/workspaces/starter-lab/settings',
      destinations: ['/verify-authentication']
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/verify-authentication')
    )
    const search = new URLSearchParams(router.state.location.searchStr)
    expect(search.get('redirect')).toBe('/workspaces/starter-lab/settings')
    expect(JSON.parse(search.get('recent') ?? 'null')).toBe('true')
    await act(() =>
      router.navigate({
        to: '/workspaces/$workspaceSlug/settings',
        params: { workspaceSlug: 'starter-lab' }
      })
    )
    expect(run).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
  })

  it('handles the direct auth management refusal through the same return flow', async () => {
    const { router } = await renderWithRouter(
      <SensitiveAction
        run={async () => {
          await unwrapAuthResult(
            async () => ({ error: { code: 'strong_authentication_required' } }),
            'Failed'
          )
        }}
      />,
      { path: '/account', destinations: ['/verify-authentication'] }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/verify-authentication')
    )
    expect(new URLSearchParams(router.state.location.searchStr).get('redirect')).toBe(
      '/account'
    )
  })
})

it('refuses a preview action locally without executing it or entering verification', async () => {
  const run = vi
    .fn<() => Promise<void>>()
    .mockRejectedValue(new UiError('strong_authentication_required', {}, 'verify'))
  const { router } = await renderWithRouter(
    <PreviewProvider>
      <SensitiveAction run={run} />
    </PreviewProvider>,
    { path: '/demo/settings', destinations: ['/verify-authentication'] }
  )
  fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
  await screen.findByText(/This preview is read-only. No changes were made./)
  expect(run).not.toHaveBeenCalled()
  expect(router.state.location.pathname).toBe('/demo/settings')
})
