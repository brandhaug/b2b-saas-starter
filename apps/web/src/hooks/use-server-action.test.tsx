import { Button } from '@/components/ui/button'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { UiError } from '@/lib/ui-error'
import { unwrapAuthResult } from '@/lib/auth-result'
import { useServerAction, type ServerActionOutcome } from './use-server-action'
import { ActionFeedback } from '@/components/page/action-feedback'

function ObservedAction({
  call,
  complete,
  settled,
  identityKey = 'one'
}: {
  readonly call: (input: string) => Promise<string>
  readonly complete?: () => Promise<void>
  readonly settled: (outcome: ServerActionOutcome<string>) => void
  readonly identityKey?: string
}) {
  const action = useServerAction(call, {
    failureMessage: 'Action failed',
    onSuccess: async () => {
      await complete?.()
    },
    identityKey
  })
  async function run(input: string) {
    settled(await action.runAsync(input))
  }
  return (
    <>
      <Button type="button" onClick={() => void run('first')}>
        First
      </Button>
      <Button type="button" onClick={() => void run('second')}>
        Second
      </Button>
      <Button type="button" onClick={action.reset}>
        Reset
      </Button>
      <output>{action.pending ? 'Pending' : 'Idle'}</output>
      <output>{action.result}</output>
      <ActionFeedback error={action.error} />
    </>
  )
}

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

describe('mutation ownership', () => {
  it('refuses another submission until the first write and refresh settle', async () => {
    let resolve!: (value: string) => void
    const pending = new Promise<string>((_resolve) => {
      resolve = _resolve
    })
    const call = vi.fn(() => pending)
    const settled = vi.fn()
    await renderWithRouter(<ObservedAction call={call} settled={settled} />)
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    fireEvent.click(screen.getByRole('button', { name: 'Second' }))
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByText('Pending')).not.toBeNull()
    await act(async () => {
      resolve('receipt')
      await pending
    })
    await waitFor(() => expect(screen.getByText('receipt')).not.toBeNull())
    expect(call).toHaveBeenCalledTimes(1)
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, value: 'receipt' })
    )
  })

  it('retains a successful write receipt when refresh rejects', async () => {
    const call = vi.fn(async () => 'receipt')
    const settled = vi.fn()
    const { router } = await renderWithRouter(
      <ObservedAction call={call} settled={settled} />
    )
    vi.spyOn(router, 'invalidate').mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    await waitFor(() =>
      expect(settled).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, value: 'receipt' })
      )
    )
    expect(screen.getByText('receipt')).not.toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('completed')
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('suppresses successful callbacks after the originating view unmounts', async () => {
    let resolve!: (value: string) => void
    const pending = new Promise<string>((_resolve) => {
      resolve = _resolve
    })
    const complete = vi.fn(async () => {})
    const settled = vi.fn()
    const { router } = await renderWithRouter(
      <ObservedAction call={() => pending} complete={complete} settled={settled} />,
      { destinations: ['/account'] }
    )
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    await act(() => router.navigate({ to: '/account' }))
    await act(async () => {
      resolve('old receipt')
      await pending
    })
    expect(complete).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
  })
})
