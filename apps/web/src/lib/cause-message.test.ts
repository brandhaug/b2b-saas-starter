import { describe, expect, it } from 'vitest'
import { causeMessage } from './cause-message'

const FALLBACK = 'Failed to send the invitation'

describe('causeMessage', () => {
  it('reads the message off an Error', () => {
    expect(causeMessage(new Error('D1 is unreachable'), FALLBACK)).toBe(
      'D1 is unreachable'
    )
  })

  it('keeps the message of an Error subclass', () => {
    expect(causeMessage(new TypeError('fetch failed'), FALLBACK)).toBe('fetch failed')
  })

  it('falls back for values that are not Errors', () => {
    expect(causeMessage('boom', FALLBACK)).toBe(FALLBACK)
    expect(causeMessage({ status: 500 }, FALLBACK)).toBe(FALLBACK)
    expect(causeMessage(undefined, FALLBACK)).toBe(FALLBACK)
  })

  // An empty message is no message: showing it would leave the form or the
  // audit reason blank, so it is treated the same as a non-Error value. The
  // message is cleared after construction because `unicorn/error-message`
  // rightly forbids writing `new Error('')` — the state is still reachable.
  it('falls back for an Error with an empty message', () => {
    const blank = new Error('cleared below')
    blank.message = ''
    expect(causeMessage(blank, FALLBACK)).toBe(FALLBACK)
  })
})
