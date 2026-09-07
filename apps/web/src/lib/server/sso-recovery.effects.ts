import { Effect } from 'effect'
import type * as Scope from 'effect/Scope'
import { SsoConnections } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { SsoPolicy } from '@b2b-saas-starter/capabilities/governance/sso-policy'
import { type CapabilityServices } from '@b2b-saas-starter/capabilities/layers'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { runCapabilities, runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { webSsoBinding } from './sso-binding'
import { type SsoRecoveryActivation } from './sso-recovery'

const REPAIR_PURPOSE: 'sso_repair' = 'sso_repair'

export async function activateSsoRecoveryHandler(input: {
  readonly exceptionId: string
}): Promise<SsoRecoveryActivation> {
  const session = await requireRequestSession()
  return runCapabilities(
    Effect.flatMap(SsoPolicy, (policy) =>
      policy.useRecoveryException({
        exceptionId: input.exceptionId,
        userId: session.user.id,
        sessionId: session.session.id
      })
    )
  )
}

type RepairInput = { readonly workspaceSlug: string }
type UpdateInput = RepairInput & { readonly providerId: string }

function runRepair<A, E>(
  workspaceSlug: string,
  userId: string,
  effect: Effect.Effect<A, E, CapabilityServices | WorkspaceContext | Scope.Scope>
) {
  return runWorkspaceCapabilities(
    workspaceSlug,
    effect,
    { userId },
    { ssoBinding: webSsoBinding },
    REPAIR_PURPOSE
  )
}

export async function loadSsoRecoveryHandler(input: RepairInput) {
  const session = await requireRequestSession()
  return runRepair(
    input.workspaceSlug,
    session.user.id,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ sso: ['update'] })
      return yield* Effect.flatMap(SsoConnections, (sso) => sso.list)
    })
  )
}

export async function updateSsoRecoveryHandler(input: UpdateInput) {
  const session = await requireRequestSession()
  return runRepair(
    input.workspaceSlug,
    session.user.id,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ sso: ['update'] })
      return yield* Effect.flatMap(SsoConnections, (sso) =>
        sso.update({ providerId: input.providerId, requireSso: false })
      )
    })
  )
}
