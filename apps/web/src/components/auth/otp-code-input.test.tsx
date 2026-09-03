import { useState } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { OtpCodeInput } from './otp-code-input'

function Harness({ onChange }: { readonly onChange?: (value: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <OtpCodeInput
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

function cell(index: number): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(`Digit ${index + 1} of 6`)
}

describe('OtpCodeInput', () => {
  it('fills cells left to right and reports the joined value', async () => {
    const onChange = vi.fn()
    await renderWithRouter(<Harness onChange={onChange} />)
    fireEvent.change(cell(0), { target: { value: '4' } })
    fireEvent.change(cell(1), { target: { value: '2' } })
    expect(onChange).toHaveBeenLastCalledWith('42')
    expect(cell(0).value).toBe('4')
    expect(cell(1).value).toBe('2')
    expect(cell(2).value).toBe('')
  })

  it('ignores non-digit input', async () => {
    const onChange = vi.fn()
    await renderWithRouter(<Harness onChange={onChange} />)
    fireEvent.change(cell(0), { target: { value: 'a' } })
    expect(onChange).toHaveBeenCalledWith('')
    expect(cell(0).value).toBe('')
  })

  it('consumes the last digit on Backspace and moves focus back', async () => {
    await renderWithRouter(<Harness />)
    fireEvent.change(cell(0), { target: { value: '9' } })
    fireEvent.change(cell(1), { target: { value: '8' } })
    fireEvent.keyDown(cell(2), { key: 'Backspace' })
    expect(cell(0).value).toBe('9')
    expect(cell(1).value).toBe('')
    // Focus followed the consumed digit.
    expect(document.activeElement).toBe(cell(1))
  })

  it('fills from a pasted code and keeps only six digits', async () => {
    const onChange = vi.fn()
    await renderWithRouter(<Harness onChange={onChange} />)
    fireEvent.paste(cell(0))
    fireEvent.change(cell(0), { target: { value: '123456789' } })
    expect(onChange).toHaveBeenLastCalledWith('123456')
    for (let index = 0; index < 6; index += 1) {
      expect(cell(index).value).toBe(String(index + 1))
    }
  })

  it('moves focus with the arrow keys', async () => {
    await renderWithRouter(<Harness />)
    fireEvent.keyDown(cell(1), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cell(0))
    fireEvent.keyDown(cell(0), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cell(1))
  })

  it('selects the cell contents on focus', async () => {
    await renderWithRouter(<Harness />)
    const first = cell(0)
    fireEvent.change(first, { target: { value: '1' } })
    fireEvent.focus(first)
    expect(first.selectionStart).toBe(0)
    expect(first.selectionEnd).toBe(1)
  })
})
