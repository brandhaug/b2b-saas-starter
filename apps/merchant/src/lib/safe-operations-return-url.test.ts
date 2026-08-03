import { describe, expect, it } from 'vitest'
import { safeOperationsReturnUrl } from './safe-operations-return-url.ts'

describe('safe Operations return URLs', () => {
  it('accepts the configured impersonation destination shape over HTTPS', () => {
    expect(
      safeOperationsReturnUrl(
        'https://operations.example.test/merchants/merchant-1/members/member-1'
      )
    ).toBe('https://operations.example.test/merchants/merchant-1/members/member-1')
  })

  it('allows HTTP only for local development', () => {
    expect(
      safeOperationsReturnUrl(
        'http://localhost:3073/merchants/merchant-1/members/member-1'
      )
    ).toBe('http://localhost:3073/merchants/merchant-1/members/member-1')
    expect(
      safeOperationsReturnUrl(
        'http://operations.example.test/merchants/merchant-1/members/member-1'
      )
    ).toBeNull()
  })

  it('rejects credentials, query strings, fragments, and unrelated paths', () => {
    expect(
      safeOperationsReturnUrl(
        'https://operator:secret@operations.example.test/merchants/a/members/b'
      )
    ).toBeNull()
    expect(
      safeOperationsReturnUrl(
        'https://operations.example.test/merchants/a/members/b?next=https://evil.test'
      )
    ).toBeNull()
    expect(
      safeOperationsReturnUrl(
        'https://operations.example.test/merchants/a/members/b#confirm'
      )
    ).toBeNull()
    expect(safeOperationsReturnUrl('https://evil.test/sign-in')).toBeNull()
  })
})
