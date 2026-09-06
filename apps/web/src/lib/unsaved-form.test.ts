import { afterEach, describe, expect, it } from 'vite-plus/test'
import { hasEditedForms, trackFormEdits } from './unsaved-form'

let stopTracking: (() => void) | undefined

afterEach(() => {
  stopTracking?.()
  document.body.replaceChildren()
})

describe('language-switch edit warning', () => {
  it('warns after a form edit and stops warning after reset or removal', () => {
    document.body.innerHTML = '<form><input name="name" /></form>'
    stopTracking = trackFormEdits()
    const form = document.querySelector('form')!
    const input = document.querySelector('input')!
    expect(hasEditedForms()).toBe(false)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(hasEditedForms()).toBe(true)
    form.reset()
    expect(hasEditedForms()).toBe(false)
    input.dispatchEvent(new Event('change', { bubbles: true }))
    form.remove()
    expect(hasEditedForms()).toBe(false)
  })

  it('ignores the language control itself', () => {
    document.body.innerHTML =
      '<form><select data-locale-control><option>English</option></select></form>'
    stopTracking = trackFormEdits()
    document
      .querySelector('select')!
      .dispatchEvent(new Event('change', { bubbles: true }))
    expect(hasEditedForms()).toBe(false)
  })
})
