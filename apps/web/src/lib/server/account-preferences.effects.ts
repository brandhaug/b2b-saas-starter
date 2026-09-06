import {
  AccountPreferencesService,
  type SetAccountPreferencesInput
} from '@b2b-saas-starter/capabilities/governance/account-preferences'
import { Effect } from 'effect'

import { runCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { type AccountPreferencesInput } from './account-preferences'

export async function setLocalePreferencesHandler(input: AccountPreferencesInput) {
  const session = await requireRequestSession()
  const value: SetAccountPreferencesInput = { userId: session.user.id, ...input }
  return runCapabilities(
    Effect.flatMap(AccountPreferencesService, (preferences) => preferences.set(value))
  )
}
