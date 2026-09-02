import { describe, expect, it } from 'vite-plus/test'
import { errorMessage, failureMessage } from './index.ts'

/**
 * An empty message is built by clearing it after construction: writing
 * `new Error('')` is what `unicorn/error-message` rightly forbids, and the
 * state is still reachable at runtime.
 */
function blankError(): Error {
  const error = new Error('cleared below')
  error.message = ''
  return error
}

describe('errorMessage', () => {
  it('reads the message off an Error', () => {
    expect(errorMessage(new Error('D1_ERROR: no such table'))).toBe(
      'D1_ERROR: no such table'
    )
  })

  it('keeps the message of an Error subclass', () => {
    expect(errorMessage(new TypeError('fetch failed'))).toBe('fetch failed')
  })

  it('treats an empty Error message as no message', () => {
    expect(errorMessage(blankError())).toBeUndefined()
  })

  it('answers undefined for anything that is not an Error', () => {
    expect(errorMessage('boom')).toBeUndefined()
    expect(errorMessage({ code: 500 })).toBeUndefined()
    expect(errorMessage(undefined)).toBeUndefined()
  })
})

describe('failureMessage', () => {
  it('prefers the Error message', () => {
    expect(failureMessage(new Error('rate limited'))).toBe('rate limited')
  })

  it('falls back to the value itself', () => {
    expect(failureMessage('boom')).toBe('boom')
    expect(failureMessage(404)).toBe('404')
    expect(failureMessage(blankError())).toBe('Error')
  })
})
