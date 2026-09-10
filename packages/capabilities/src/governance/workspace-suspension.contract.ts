import { Effect } from 'effect'
import { type expect as vitestExpect } from '@effect/vitest'
import { WorkspaceSuspensionService } from './workspace-suspension.ts'

export function workspaceSuspensionContractCases(expect: typeof vitestExpect) {
  return [
    {
      name: 'suspends, denies product work, permits recovery, then reactivates',
      assert: Effect.gen(function* () {
        const suspension = yield* WorkspaceSuspensionService
        const suspended = yield* suspension.transition({
          workspaceId: 'wrk_live',
          action: 'suspend',
          actor: { userId: 'usr_sysadmin' },
          internalReason: 'payment investigation',
          customerExplanation:
            'Access is temporarily limited while we review your account.'
        })
        expect(suspended.status).toBe('suspended')
        const denied = yield* suspension
          .requireAllowed('wrk_live', 'product')
          .pipe(Effect.result)
        expect(denied).toMatchObject({
          _tag: 'Failure',
          failure: { _tag: 'WorkspaceSuspended' }
        })
        yield* suspension.requireAllowed('wrk_live', 'billing_recovery')
        const active = yield* suspension.transition({
          workspaceId: 'wrk_live',
          action: 'unsuspend',
          actor: { userId: 'usr_sysadmin' },
          internalReason: 'review completed'
        })
        expect(active.status).toBe('active')
        yield* suspension.requireAllowed('wrk_live', 'product')
      })
    },
    {
      name: 'rejects non-admin and impersonating actors',
      assert: Effect.gen(function* () {
        const suspension = yield* WorkspaceSuspensionService
        for (const actor of [
          { userId: 'usr_owner' },
          { userId: 'usr_sysadmin', impersonatedBy: 'usr_other' }
        ]) {
          const result = yield* Effect.exit(
            suspension.transition({
              workspaceId: 'wrk_live',
              action: 'suspend',
              actor,
              internalReason: 'operator review',
              customerExplanation: 'Access is temporarily limited.'
            })
          )
          expect(result._tag).toBe('Failure')
        }
      })
    },
    {
      name: 'requires both suspension reasons and a reactivation reason',
      assert: Effect.gen(function* () {
        const suspension = yield* WorkspaceSuspensionService
        for (const input of [
          {
            action: 'suspend',
            internalReason: ' ',
            customerExplanation: 'Contact support.'
          },
          { action: 'suspend', internalReason: 'Review', customerExplanation: ' ' },
          {
            action: 'unsuspend',
            internalReason: ' ',
            customerExplanation: 'Contact support.'
          }
        ] satisfies ReadonlyArray<{
          action: 'suspend' | 'unsuspend'
          internalReason: string
          customerExplanation: string
        }>) {
          const refusal = yield* suspension
            .transition({
              ...input,
              workspaceId: 'wrk_live',
              actor: { userId: 'usr_sysadmin' }
            })
            .pipe(Effect.result)
          expect(refusal).toMatchObject({
            _tag: 'Failure',
            failure: { _tag: 'WorkspaceSuspensionUnauthorized' }
          })
          expect((yield* suspension.get('wrk_live')).status).toBe('active')
        }
      })
    },
    {
      // The operator console renders this list as-is, so its order is part of
      // the contract. Both harnesses hold more than one workspace and neither
      // declares them in name order, so an adapter that returned insertion
      // order fails here.
      name: 'lists workspaces by name, with ids breaking ties',
      assert: Effect.gen(function* () {
        const suspension = yield* WorkspaceSuspensionService
        const listed = yield* suspension.list
        expect(listed.length > 1).toBe(true)
        // `\u0000` sorts below every printable character, so comparing the
        // joined key is comparing `(name, id)` — SQLite's BINARY collation.
        const keys = listed.map((row) => `${row.name}\u0000${row.id}`)
        expect(keys).toEqual(keys.toSorted())
      })
    },
    {
      name: 'fails closed for an unknown workspace',
      assert: Effect.gen(function* () {
        const suspension = yield* WorkspaceSuspensionService
        const result = yield* Effect.exit(
          suspension.requireAllowed('wrk_missing', 'product')
        )
        expect(result._tag).toBe('Failure')
      })
    }
  ]
}
