import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { nextTotpCode } from './test-totp.ts'

// RFC 4226 Appendix D: https://www.rfc-editor.org/rfc/rfc4226.html#appendix-D
describe('nextTotpCode', () => {
  it.effect('uses the RFC 4226 code on each side of the 30-second boundary', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(29_999)
      expect(yield* nextTotpCode('12345678901234567890')).toEqual({ code: '287082' })

      yield* TestClock.setTime(30_000)
      expect(yield* nextTotpCode('12345678901234567890')).toEqual({ code: '359152' })
    })
  )
})
