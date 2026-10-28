import * as alerting from '@distilled.cloud/cloudflare/alerting'
import { StackContext } from 'alchemy/StackContext'
import { Stage } from 'alchemy/Stage'
import { State } from 'alchemy/State/State'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

type DesiredPolicy = {
  readonly logicalId: string
  readonly name: string
  readonly resourceType: string
  readonly alertType: string
  readonly adoptPolicyId?: string | undefined
}

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is Effect's error-class factory.
class MonitoringOwnershipError extends Schema.TaggedError<MonitoringOwnershipError>()(
  'MonitoringOwnershipError',
  { message: Schema.String }
) {}

const SavedPolicy = Schema.Struct({
  resourceType: Schema.String,
  attr: Schema.Struct({ policyId: Schema.String, accountId: Schema.String })
})
const decodeSavedPolicy = Schema.decodeUnknownEffect(SavedPolicy)

/** The list effect must include every page; failures must stop the plan. */
export const checkMonitoringPolicyOwnership = Effect.fn(
  'Monitoring.checkPolicyOwnership'
)(function* <E, R, SE, SR>(
  accountId: string,
  desired: ReadonlyArray<DesiredPolicy>,
  inventory: {
    readonly list: Effect.Effect<ReadonlyArray<alerting.PoliciesListResultItem>, E, R>
    readonly saved: (logicalId: string) => Effect.Effect<unknown, SE, SR>
  }
) {
  if (desired.length === 0) {
    return
  }
  const policies = yield* inventory.list
  const byId = new Map(policies.map((policy) => [policy.id, policy]))
  for (const policy of desired) {
    const matches = policies.filter((observed) => observed.name === policy.name)
    if (matches.length > 1) {
      return yield* new MonitoringOwnershipError({
        message: `Rejecting duplicate policies named ${policy.name}`
      })
    }
    const persisted = yield* inventory.saved(policy.logicalId)
    let savedId: string | undefined
    if (persisted !== undefined) {
      const saved = yield* decodeSavedPolicy(persisted).pipe(
        Effect.mapError(
          () =>
            new MonitoringOwnershipError({
              message: `Incomplete saved ownership for ${policy.logicalId}; recover state before proceeding`
            })
        )
      )
      if (
        saved.resourceType !== policy.resourceType ||
        saved.attr.accountId !== accountId
      ) {
        return yield* new MonitoringOwnershipError({
          message: `Saved policy type/account differs for ${policy.logicalId}`
        })
      }
      savedId = saved.attr.policyId
    }
    const match = matches[0]
    if (
      policy.adoptPolicyId !== undefined &&
      (match?.id !== policy.adoptPolicyId ||
        (savedId !== undefined && savedId !== policy.adoptPolicyId))
    ) {
      return yield* new MonitoringOwnershipError({
        message: `Explicit adoption ID does not match the unique policy for ${policy.name}`
      })
    }
    if (
      match &&
      (match.id === null ||
        match.id === undefined ||
        (match.id !== savedId && match.id !== policy.adoptPolicyId))
    ) {
      return yield* new MonitoringOwnershipError({
        message: `Rejecting unowned policy named ${policy.name}; supply its verified adoptPolicyId to authorize adoption`
      })
    }
    const owned = byId.get(savedId)
    if (
      (match && match.alertType !== policy.alertType) ||
      (owned && owned.alertType !== policy.alertType)
    ) {
      return yield* new MonitoringOwnershipError({
        message: `Existing alert type differs for ${policy.name}`
      })
    }
  }
})

/** Uses the same state keys and authenticated SDK as the native providers. Read-only. */
export const preflightMonitoringPolicies = Effect.fn('Monitoring.preflightPolicies')(
  function* (accountId: string, desired: ReadonlyArray<DesiredPolicy>) {
    if (desired.length === 0) {
      return
    }
    const state = yield* yield* State
    const stack = yield* StackContext
    const stage = yield* Stage
    yield* checkMonitoringPolicyOwnership(accountId, desired, {
      list: alerting.listPolicies.items({ accountId }).pipe(Stream.runCollect),
      // Resources are declared at the stack root, so their FQN is their logical ID.
      saved: (fqn) => state.get({ stack: stack.name, stage, fqn })
    })
  }
)
