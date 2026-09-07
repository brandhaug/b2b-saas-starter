import { type SsoConnection } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { type SsoRecoveryException } from '@b2b-saas-starter/capabilities/governance/sso-policy'
import { createServerFn } from '@tanstack/react-start'
import { Option, Schema } from 'effect'

const ExceptionInput = Schema.Struct({ exceptionId: Schema.NonEmptyString })
const WorkspaceInput = Schema.Struct({ workspaceSlug: Schema.NonEmptyString })
const UpdateInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  providerId: Schema.NonEmptyString
})

export type SsoRecoveryActivation = Pick<
  SsoRecoveryException,
  'workspaceId' | 'expiresAt'
>

export const activateSsoRecoveryServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(ExceptionInput))
  .handler(async ({ data }): Promise<SsoRecoveryActivation> => {
    const { activateSsoRecoveryHandler } = await import('./sso-recovery.effects')
    return activateSsoRecoveryHandler(data)
  })

export const loadSsoRecoveryServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(WorkspaceInput))
  .handler(async ({ data }): Promise<ReadonlyArray<SsoConnection>> => {
    const { loadSsoRecoveryHandler } = await import('./sso-recovery.effects')
    return loadSsoRecoveryHandler(data)
  })

export const updateSsoRecoveryServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(UpdateInput))
  .handler(async ({ data }): Promise<SsoConnection | null> => {
    const { updateSsoRecoveryHandler } = await import('./sso-recovery.effects')
    return Option.getOrNull(await updateSsoRecoveryHandler(data))
  })
