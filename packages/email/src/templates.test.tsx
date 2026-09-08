import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { render } from 'react-email'
import { type Locale } from '@b2b-saas-starter/i18n/locale'
import {
  AccountDeletedEmail,
  OneTimeCodeEmail,
  PasskeyChangedEmail,
  TwoFactorChangedEmail
} from './templates.tsx'

// Both counts can be singular independently in an account deletion receipt.
describe.each([
  {
    locale: 'en',
    singular: '1 workspace',
    plural: '2 workspaces',
    incorrect: '1 workspaces'
  },
  {
    locale: 'nb',
    singular: '1 arbeidsområde',
    plural: '2 arbeidsområder',
    incorrect: '1 arbeidsområder'
  }
] satisfies ReadonlyArray<{
  locale: Locale
  singular: string
  plural: string
  incorrect: string
}>)('account receipts in $locale', ({ locale, singular, plural, incorrect }) => {
  it.effect('handles deleted and left counts independently', () =>
    Effect.gen(function* () {
      for (const counts of [
        { workspacesDeleted: 1, workspacesLeft: 2 },
        { workspacesDeleted: 2, workspacesLeft: 1 }
      ]) {
        const text = yield* Effect.promise(() =>
          render(AccountDeletedEmail({ ...counts, locale }), { plainText: true })
        )
        expect(text).toContain(singular)
        expect(text).toContain(plural)
        expect(text).not.toContain(incorrect)
      }
    })
  )
})

describe.each([
  { enabled: true, en: 'turned on', nb: 'slått på' },
  { enabled: false, en: 'turned off', nb: 'slått av' }
])('two-factor enabled=$enabled', ({ enabled, en, nb }) => {
  it.effect('reports the change in both languages', () =>
    Effect.gen(function* () {
      const english = yield* Effect.promise(() =>
        render(TwoFactorChangedEmail({ enabled, locale: 'en' }), { plainText: true })
      )
      const norwegian = yield* Effect.promise(() =>
        render(TwoFactorChangedEmail({ enabled, locale: 'nb' }), { plainText: true })
      )
      expect(english).toContain(en)
      expect(norwegian).toContain(nb)
    })
  )
})

describe.each([
  { added: true, en: 'was added', nb: 'ble lagt til' },
  { added: false, en: 'was removed', nb: 'ble fjernet' }
])('passkey added=$added', ({ added, en, nb }) => {
  it.effect('reports the change in both languages', () =>
    Effect.gen(function* () {
      const english = yield* Effect.promise(() =>
        render(PasskeyChangedEmail({ added, locale: 'en' }), { plainText: true })
      )
      const norwegian = yield* Effect.promise(() =>
        render(PasskeyChangedEmail({ added, locale: 'nb' }), { plainText: true })
      )
      expect(english).toContain(en)
      expect(norwegian).toContain(nb)
    })
  )
})

it.effect('keeps codes copyable and out of inbox previews for every purpose', () =>
  Effect.gen(function* () {
    const purposes: ReadonlyArray<Parameters<typeof OneTimeCodeEmail>[0]['purpose']> = [
      'sign-in',
      'email-verification',
      'forget-password',
      'change-email'
    ]
    for (const purpose of purposes) {
      const html = yield* Effect.promise(() =>
        render(OneTimeCodeEmail({ code: '048291', purpose }))
      )
      const text = yield* Effect.promise(() =>
        render(OneTimeCodeEmail({ code: '048291', purpose }), { plainText: true })
      )
      expect(text).toContain('048291')
      expect(html).not.toContain('href=')
      const preview = html.slice(html.indexOf('<body'), html.indexOf('</div>'))
      expect(preview).not.toContain('048291')
    }
  })
)

it.effect('keeps Norwegian language metadata on the body as well as the document', () =>
  Effect.gen(function* () {
    const html = yield* Effect.promise(() =>
      render(TwoFactorChangedEmail({ enabled: false, locale: 'nb' }))
    )
    expect(html).toContain('lang="nb-NO"')
    expect(html).not.toMatch(/\blang="en(?:-US)?"/)
  })
)
