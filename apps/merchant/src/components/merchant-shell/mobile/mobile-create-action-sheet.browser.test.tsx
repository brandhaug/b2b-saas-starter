// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  MobileCreateActionSheet,
  type MobileCreateIntent
} from './mobile-create-action-sheet.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let originalShowModal: typeof HTMLDialogElement.prototype.showModal | undefined
let originalClose: typeof HTMLDialogElement.prototype.close | undefined
const showModal = vi.fn()

beforeAll(() => {
  originalShowModal = HTMLDialogElement.prototype.showModal
  originalClose = HTMLDialogElement.prototype.close
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: showModal
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute('open')
      }
    }
  })
})

afterAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: originalShowModal },
    close: { configurable: true, value: originalClose }
  })
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  showModal.mockClear()
})

const waitForSpring = () =>
  act(async () => new Promise((resolve) => setTimeout(resolve, 1_000)))

describe('MobileCreateActionSheet interaction', () => {
  it('can be opened again after canceling', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    function Harness() {
      const [open, setOpen] = useState(false)
      const [generation, setGeneration] = useState(0)
      return (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              setGeneration((value) => value + 1)
              setOpen(true)
            }}
          >
            Add
          </button>
          <MobileCreateActionSheet
            key={generation}
            open={open}
            onRequestClose={() => setOpen(false)}
            onSelect={vi.fn()}
          />
        </>
      )
    }

    await act(async () => root?.render(<Harness />))
    const add = container.querySelector<HTMLButtonElement>('button')

    await act(async () => add?.click())
    await waitForSpring()
    const cancel = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel'
    )

    await act(async () => cancel?.click())
    await act(async () => add?.click())
    await waitForSpring()
    expect(
      container.querySelector<HTMLDialogElement>(
        '[data-mobile-create-action-sheet="true"]'
      )?.open
    ).toBe(true)
    expect(showModal).not.toHaveBeenCalled()
  })

  it('closes before handing the selected intent to the next flow', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const selected: MobileCreateIntent[] = []

    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <MobileCreateActionSheet
          open={open}
          onRequestClose={() => setOpen(false)}
          onSelect={(intent) => selected.push(intent)}
        />
      )
    }

    await act(async () => root?.render(<Harness />))
    await waitForSpring()

    const dialog = container.querySelector<HTMLDialogElement>(
      '[data-mobile-create-action-sheet="true"]'
    )
    const blockTime = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Block time'
    )
    expect(dialog?.open).toBe(true)
    expect(document.activeElement?.textContent).toBe('Appointment')

    await act(async () => blockTime?.click())
    expect(dialog?.dataset.mobileCreateActionSheetState).toBe('closing')
    expect(selected).toEqual([])

    await waitForSpring()
    expect(container.querySelector('[data-mobile-create-action-sheet]')).toBeNull()
    expect(selected).toEqual(['block-time'])
  })
})
