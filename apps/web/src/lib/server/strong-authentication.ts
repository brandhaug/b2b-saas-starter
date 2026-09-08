import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

import { type StrongAuthenticationStatus } from '@b2b-saas-starter/capabilities/governance/strong-authentication'
export type { StrongAuthenticationStatus } from '@b2b-saas-starter/capabilities/governance/strong-authentication'

export const strongAuthenticationStatusServerFn = createServerFn({
  method: 'GET'
}).handler(async (): Promise<StrongAuthenticationStatus> => {
  const { readStrongAuthenticationStatus } =
    await import('./strong-authentication.effects')
  return readStrongAuthenticationStatus()
})

const VerifyCurrentPasswordInput = Schema.Struct({ password: Schema.NonEmptyString })
export const verifyCurrentPasswordServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(VerifyCurrentPasswordInput))
  .handler(async ({ data }): Promise<boolean> => {
    const { verifyCurrentPassword } = await import('./strong-authentication.effects')
    return verifyCurrentPassword(data.password)
  })
