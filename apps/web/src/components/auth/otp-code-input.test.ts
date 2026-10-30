import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { describe, expect, it } from 'vite-plus/test'
import { renderAuth } from '../native-test-harness'
import { m } from '@b2b-saas-starter/i18n/messages'

// Migrated failure inventory: digit order, non-digits, empty-cell Backspace,
// replacement, suffix compaction, paste truncation, arrow focus and selection.
function cell(index: number): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(
    m.public_auth_otp_digit({ index: index + 1, length: 6 })
  )
}
function value(): string {
  return Array.from({ length: 6 }, (_, index) => cell(index).value).join('')
}
async function enter(index: number, digits: string, expected: string) {
  fireEvent.input(cell(index), { target: { value: digits } })
  await waitFor(() => expect(value()).toBe(expected))
}

describe('native one-time-code input', () => {
  it('fills cells left to right and reports the joined value', async () => {
    await renderAuth('two-factor')
    await enter(0, '4', '4')
    await enter(1, '2', '42')
    expect(cell(0).value).toBe('4')
    expect(cell(1).value).toBe('2')
    expect(cell(2).value).toBe('')
  })

  it('ignores non-digit input', async () => {
    await renderAuth('two-factor')
    await enter(0, 'a', '')
    expect(cell(0).value).toBe('')
  })

  it('consumes the last digit on Backspace and moves focus back', async () => {
    await renderAuth('two-factor')
    await enter(0, '98', '98')
    fireEvent.keyDown(cell(2), { key: 'Backspace' })
    await waitFor(() => expect(value()).toBe('9'))
    await waitFor(() => expect(document.activeElement).toBe(cell(1)))
  })

  it('replaces the digit in the focused cell', async () => {
    await renderAuth('two-factor')
    await enter(0, '123456', '123456')
    fireEvent.focus(cell(2))
    await enter(2, '9', '129456')
    await waitFor(() => expect(document.activeElement).toBe(cell(3)))
  })

  it('removes the focused digit on Backspace and shifts the suffix left', async () => {
    await renderAuth('two-factor')
    await enter(0, '1234', '1234')
    fireEvent.keyDown(cell(2), { key: 'Backspace' })
    await waitFor(() => expect(value()).toBe('124'))
    await waitFor(() => expect(document.activeElement).toBe(cell(1)))
  })

  it('fills from a pasted code and keeps only six digits', async () => {
    await renderAuth('two-factor')
    fireEvent.paste(cell(0))
    await enter(0, '123456789', '123456')
    for (let index = 0; index < 6; index += 1) {
      expect(cell(index).value).toBe(String(index + 1))
    }
  })

  it('moves focus with the arrow keys', async () => {
    await renderAuth('two-factor')
    fireEvent.keyDown(cell(1), { key: 'ArrowLeft' })
    await waitFor(() => expect(document.activeElement).toBe(cell(0)))
    fireEvent.keyDown(cell(0), { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(cell(1)))
  })

  it('selects the cell contents on focus', async () => {
    await renderAuth('two-factor')
    await enter(0, '1', '1')
    fireEvent.focus(cell(0))
    await waitFor(() => {
      expect(cell(0).selectionStart).toBe(0)
      expect(cell(0).selectionEnd).toBe(1)
    })
  })
})
