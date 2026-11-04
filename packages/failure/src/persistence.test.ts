import { describe, expect, it } from '@effect/vitest'
import { Cause, Effect, Exit } from 'effect'
import { orUnavailable } from './capability.ts'
import { PersistenceDecodeError } from './persistence.ts'

describe('persistence failure translation', () => {
  it.effect('sanitizes SQL failures and translates only recognized codec defects', () =>
    Effect.gen(function* () {
      const sql = yield* Effect.exit(
        Effect.fail({
          _tag: 'EffectDrizzleQueryError',
          message: 'select secret from private where token = secret-value'
        }).pipe(orUnavailable('test-query'))
      )
      expect(sql).toMatchObject({
        _tag: 'Failure',
        cause: {
          reasons: [
            {
              _tag: 'Fail',
              error: { _tag: 'CapabilityUnavailable', reason: 'persistence_sql' }
            }
          ]
        }
      })
      const decode = yield* Effect.exit(
        Effect.die(
          new PersistenceDecodeError({
            column: 'api_tokens.scopes',
            operation: 'read'
          })
        ).pipe(orUnavailable('tokens'))
      )
      expect(decode).toMatchObject({
        _tag: 'Failure',
        cause: {
          reasons: [
            {
              _tag: 'Fail',
              error: { reason: 'persistence_decode:api_tokens.scopes:read' }
            }
          ]
        }
      })
    })
  )

  it.effect('preserves unrelated defects and interruption in mixed causes', () =>
    Effect.gen(function* () {
      const defect = new Error('programming bug')
      const original = Cause.fromReasons([
        Cause.makeDieReason(defect),
        Cause.makeInterruptReason(42),
        Cause.makeDieReason(
          new PersistenceDecodeError({ column: 'records.data', operation: 'read' })
        )
      ])
      const exit = yield* Effect.exit(
        Effect.failCause(original).pipe(orUnavailable('records'))
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons[0]).toEqual(original.reasons[0])
        expect(exit.cause.reasons[1]).toEqual(original.reasons[1])
        expect(exit.cause.reasons[2]?._tag).toBe('Fail')
      }
    })
  )
})
