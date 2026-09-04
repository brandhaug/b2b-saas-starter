import { Effect } from 'effect'
import { describe, expect, it } from 'vite-plus/test'
import {
  impersonationForbiddenAction,
  impersonationGuardResponse
} from './impersonation-guard'

const impersonated = { impersonatedBy: 'usr_admin' }
const ordinary = { impersonatedBy: null }

function post(pathname: string) {
  return { method: 'POST', pathname }
}

describe('impersonationForbiddenAction', () => {
  it('maps the password, two-factor, email and delete endpoints onto the capability vocabulary', () => {
    expect(impersonationForbiddenAction(post('/api/auth/change-password'))).toBe(
      'change_password'
    )
    expect(impersonationForbiddenAction(post('/api/auth/two-factor/enable'))).toBe(
      'change_two_factor'
    )
    expect(impersonationForbiddenAction(post('/api/auth/two-factor/disable'))).toBe(
      'change_two_factor'
    )
    expect(
      impersonationForbiddenAction(post('/api/auth/two-factor/generate-backup-codes'))
    ).toBe('change_two_factor')
    expect(impersonationForbiddenAction(post('/api/auth/change-email'))).toBe(
      'change_email'
    )
    expect(impersonationForbiddenAction(post('/api/auth/delete-user'))).toBe(
      'delete_account'
    )
  })

  it('leaves every other exchange alone, including reads', () => {
    expect(impersonationForbiddenAction(post('/api/auth/sign-out'))).toBeNull()
    expect(
      impersonationForbiddenAction(post('/api/auth/two-factor/verify-totp'))
    ).toBeNull()
    expect(
      impersonationForbiddenAction({
        method: 'GET',
        pathname: '/api/auth/change-password'
      })
    ).toBeNull()
  })
})

describe('impersonationGuardResponse', () => {
  it('answers 403 for a forbidden action on an impersonation session', async () => {
    const response = await Effect.runPromise(
      impersonationGuardResponse(post('/api/auth/change-password'), impersonated)
    )
    expect(response?.status).toBe(403)
    expect(await response?.json()).toEqual({
      code: 'forbidden_while_impersonating',
      action: 'change_password'
    })
  })

  it('lets an ordinary session, an anonymous request, and an allowed action through', async () => {
    expect(
      await Effect.runPromise(
        impersonationGuardResponse(post('/api/auth/change-password'), ordinary)
      )
    ).toBeNull()
    expect(
      await Effect.runPromise(
        impersonationGuardResponse(post('/api/auth/change-password'), undefined)
      )
    ).toBeNull()
    expect(
      await Effect.runPromise(
        impersonationGuardResponse(post('/api/auth/sign-out'), impersonated)
      )
    ).toBeNull()
  })
})
