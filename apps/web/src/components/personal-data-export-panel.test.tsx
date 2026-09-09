import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { PersonalDataExportPanel } from './personal-data-export-panel'
import { renderWithRouter } from '@/test/router-harness'
import { UiError } from '@/lib/ui-error'

describe('PersonalDataExportPanel', () => {
  it('keeps the request control busy until preparation finishes, then offers download', async () => {
    function resolvePending(_value: { id: string; expiresAt: string }): void {}

    let finish: (value: { id: string; expiresAt: string }) => void = resolvePending
    const pending = new Promise<{ id: string; expiresAt: string }>((resolve) => {
      finish = resolve
    })
    const request = vi.fn(() => pending)
    const download = vi.fn(async () => ({ fileName: 'personal-data.json', json: '{}' }))
    await renderWithRouter(
      <PersonalDataExportPanel request={request} download={download} />,
      { path: '/account' }
    )

    const prepare = screen.getByRole('button', { name: 'Prepare personal data' })
    fireEvent.click(prepare)
    await waitFor(() => expect(prepare.hasAttribute('disabled')).toBe(true))
    expect(screen.queryByRole('button', { name: 'Download personal data' })).toBeNull()

    finish({ id: 'export-1', expiresAt: '2026-09-16T12:00:00.000Z' })
    await screen.findByRole('button', { name: 'Download personal data' })
    fireEvent.click(screen.getByRole('button', { name: 'Download personal data' }))
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith({ data: { exportId: 'export-1' } })
    )
  })

  it('shows a safe request failure and clears it when retry succeeds', async () => {
    const request = vi
      .fn<() => Promise<{ id: string; expiresAt: string }>>()
      .mockRejectedValueOnce(new Error('private server detail'))
      .mockResolvedValueOnce({ id: 'export-2', expiresAt: '2026-09-16T12:00:00.000Z' })

    const download = vi
      .fn()
      .mockRejectedValueOnce(new Error('private download detail'))
      .mockResolvedValueOnce({ fileName: 'personal-data.json', json: '{}' })
    await renderWithRouter(
      <PersonalDataExportPanel request={request} download={download} />,
      {
        path: '/account'
      }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Prepare personal data' }))
    await screen.findByText('Could not prepare your personal data export. Try again.')
    expect(screen.queryByText('private server detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Prepare personal data' }))
    await screen.findByRole('button', { name: 'Download personal data' })
    expect(request).toHaveBeenCalledTimes(2)
    expect(
      screen.queryByText('Could not prepare your personal data export. Try again.')
    ).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Download personal data' }))
    await screen.findByText('Could not download your personal data export. Try again.')
    expect(screen.queryByText('private download detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Download personal data' }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2))
    expect(
      screen.queryByText('Could not download your personal data export. Try again.')
    ).toBeNull()
  })

  it('returns recent-authentication failures to verification', async () => {
    const request = vi
      .fn()
      .mockRejectedValue(new UiError('strong_authentication_required', {}, 'verify'))
    const { router } = await renderWithRouter(
      <PersonalDataExportPanel request={request} />,
      {
        path: '/account',
        destinations: ['/verify-authentication']
      }
    )

    fireEvent.click(screen.getByRole('button', { name: 'Prepare personal data' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/verify-authentication')
    )
    const search = new URLSearchParams(router.state.location.searchStr)
    expect(search.get('redirect')).toBe('/account')
    expect(JSON.parse(search.get('recent') ?? 'null')).toBe('true')
  })
})
