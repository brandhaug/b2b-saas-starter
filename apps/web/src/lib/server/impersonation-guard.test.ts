import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'
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
  it('maps the password, two-factor, passkey, email and delete endpoints onto the capability vocabulary', () => {
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
    // A passkey enrolled under impersonation would keep working after it ends.
    expect(
      impersonationForbiddenAction(post('/api/auth/passkey/verify-registration'))
    ).toBe('change_passkey')
    expect(impersonationForbiddenAction(post('/api/auth/passkey/delete-passkey'))).toBe(
      'change_passkey'
    )
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
    // Renaming a passkey changes a label, not a credential.
    expect(
      impersonationForbiddenAction(post('/api/auth/passkey/update-passkey'))
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
  it.effect('answers 403 for a forbidden action on an impersonation session', () =>
    Effect.gen(function* () {
      const response = yield* impersonationGuardResponse(
        impersonated,
        impersonationForbiddenAction(post('/api/auth/change-password'))
      )
      if (response === null) {
        return yield* Effect.fail('the guard must answer a forbidden action')
      }
      expect(response.status).toBe(403)
      expect(yield* Effect.promise(() => response.json())).toEqual({
        code: 'forbidden_while_impersonating',
        action: 'change_password'
      })
    })
  )

  it.effect(
    'lets an ordinary session, an anonymous request, and an allowed action through',
    () =>
      Effect.gen(function* () {
        expect(
          yield* impersonationGuardResponse(
            ordinary,
            impersonationForbiddenAction(post('/api/auth/change-password'))
          )
        ).toBeNull()
        expect(
          yield* impersonationGuardResponse(
            undefined,
            impersonationForbiddenAction(post('/api/auth/change-password'))
          )
        ).toBeNull()
        expect(
          yield* impersonationGuardResponse(
            impersonated,
            impersonationForbiddenAction(post('/api/auth/sign-out'))
          )
        ).toBeNull()
      })
  )
})
