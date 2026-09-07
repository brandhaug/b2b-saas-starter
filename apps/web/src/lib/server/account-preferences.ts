import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { accountLocales } from '@b2b-saas-starter/db/enums'

const AccountPreferencesInput = Schema.Struct({
  locale: Schema.optional(Schema.NullOr(Schema.Literals(accountLocales))),
  timeZone: Schema.optional(Schema.NullOr(Schema.String)),
  initializeTimeZone: Schema.optional(Schema.Boolean)
})
export type AccountPreferencesInput = typeof AccountPreferencesInput.Type

export const setLocalePreferencesServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(AccountPreferencesInput))
  .handler(async ({ data }) => {
    const { setLocalePreferencesHandler } =
      await import('./account-preferences.effects')
    return setLocalePreferencesHandler(data)
  })
