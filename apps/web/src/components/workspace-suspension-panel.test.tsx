import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'

import {
  WorkspaceSuspensionPanel,
  type ReactivateWorkspace,
  type SuspendWorkspace
} from './workspace-suspension-panel'
import { renderWithRouter } from '@/test/router-harness'

describe('WorkspaceSuspensionPanel', () => {
  it('requires both reasons and keeps the internal note separate', async () => {
    const suspend = vi.fn<SuspendWorkspace>().mockResolvedValue(undefined)
    const reactivate = vi.fn<ReactivateWorkspace>().mockResolvedValue(undefined)
    await renderWithRouter(
      <WorkspaceSuspensionPanel
        workspaceId="wrk_1"
        workspaceName="Starter Lab"
        suspension={{ status: 'active' }}
        suspend={suspend}
        reactivate={reactivate}
      />
    )

    const submit = screen.getByRole('button', { name: 'Suspend workspace' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Internal reason'), {
      target: { value: 'Abuse review' }
    })
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Customer explanation'), {
      target: { value: 'Please contact support.' }
    })
    expect(submit.hasAttribute('disabled')).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => {
      expect(suspend).toHaveBeenCalledWith({
        data: {
          workspaceId: 'wrk_1',
          internalReason: 'Abuse review',
          customerExplanation: 'Please contact support.'
        }
      })
    })
  })

  it('offers an idempotent reactivation action for suspended state', async () => {
    const suspend = vi.fn<SuspendWorkspace>().mockResolvedValue(undefined)
    const reactivate = vi.fn<ReactivateWorkspace>().mockResolvedValue(undefined)
    await renderWithRouter(
      <WorkspaceSuspensionPanel
        workspaceId="wrk_1"
        workspaceName="Starter Lab"
        suspension={{ status: 'suspended', suspendedAt: '2026-09-07T10:00:00Z' }}
        suspend={suspend}
        reactivate={reactivate}
      />
    )

    fireEvent.change(screen.getByLabelText('Internal reason'), {
      target: { value: 'Reactivate workspace' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate workspace' }))
    await waitFor(() => {
      expect(reactivate).toHaveBeenCalledWith({
        data: { workspaceId: 'wrk_1', internalReason: 'Reactivate workspace' }
      })
    })
    expect(suspend).not.toHaveBeenCalled()
  })
})
