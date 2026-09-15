import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { COPY_COMMAND } from '@/lib/toolchain'
import { renderWithRouter } from '@/test/router-harness'
import { ClosingSection } from './closing-section'

const writeText = vi.fn<(value: string) => Promise<void>>()

function installClipboard(value: { writeText: typeof writeText } | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value
  })
}

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  installClipboard({ writeText })
})

afterEach(() => {
  vi.useRealTimers()
})

async function renderClosing() {
  return renderWithRouter(<ClosingSection />, {
    destinations: ['/demo', '/docs']
  })
}

describe('ClosingSection command copy', () => {
  it('copies the complete clone and quickstart sequence', async () => {
    const view = await renderClosing()

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy the clone and quickstart commands' })
    )

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(COPY_COMMAND))
    expect(await screen.findByText('Copied')).toBeDefined()
    view.unmount()
  })

  it.each([
    {
      label: 'denied clipboard access',
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) }
    },
    { label: 'unavailable clipboard', clipboard: undefined }
  ])('reports $label without claiming success', async ({ clipboard }) => {
    installClipboard(clipboard)
    const view = await renderClosing()

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy the clone and quickstart commands' })
    )

    expect(
      await screen.findByText(
        'Could not copy commands. Allow clipboard access and try again.'
      )
    ).toBeDefined()
    expect(screen.queryByText('Copied')).toBeNull()
    view.unmount()
  })

  it('clears the feedback timer and ignores a late clipboard result on unmount', async () => {
    vi.useFakeTimers()
    const view = await renderClosing()

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy the clone and quickstart commands' })
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)

    let resolveCopy: (() => void) | undefined
    writeText.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCopy = resolve
      })
    )
    const pendingView = await renderClosing()
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy the clone and quickstart commands' })
    )
    pendingView.unmount()
    resolveCopy?.()
    await act(async () => {
      await Promise.resolve()
    })
    expect(vi.getTimerCount()).toBe(0)
  })
})
