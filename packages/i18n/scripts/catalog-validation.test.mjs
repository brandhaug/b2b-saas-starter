import { describe, expect, it } from 'vite-plus/test'
import {
  flattenCatalog,
  inputNames,
  mergeInto,
  validateCatalogs,
  validateProjectLocales
} from './catalog-validation.mjs'
import { LOCALES } from '../src/locale.ts'
import settings from '../project.inlang/settings.json' with { type: 'json' }

describe('catalog validation', () => {
  it('keeps the inlang project locales equal to the shipped locale set', () => {
    expect(() => validateProjectLocales(settings, LOCALES)).not.toThrow()
    expect(() =>
      validateProjectLocales({ ...settings, locales: ['en'] }, LOCALES)
    ).toThrow('Locale mismatch')
    expect(() =>
      validateProjectLocales({ ...settings, baseLocale: 'de' }, LOCALES)
    ).toThrow('baseLocale de is not one of')
  })

  it('rejects duplicate keys while merging domain catalogs', () => {
    const merged = mergeInto({}, { account: { title: 'Account' } })
    expect(() => mergeInto(merged, { account: { title: 'Profile' } })).toThrow(
      'Duplicate translation key: account.title'
    )
  })

  it('rejects aliases created by flattening nested and dotted keys', () => {
    expect(() =>
      flattenCatalog({ 'account.title': 'A', account: { title: 'B' } }, 'en')
    ).toThrow('Message key alias collision in en: account.title')
  })

  it('rejects missing and extra locale keys', () => {
    expect(() => validateCatalogs({ en: { title: 'Title' }, nb: {} })).toThrow(
      'Missing nb translation for title'
    )
    expect(() => validateCatalogs({ en: {}, nb: { title: 'Tittel' } })).toThrow(
      'Missing en translation for title'
    )
  })

  it('compares placeholder sets without treating repeated inputs as a mismatch', () => {
    expect(() =>
      validateCatalogs({
        en: { greeting: 'Hello {name}, {name}!' },
        nb: { greeting: 'Hei {name}!' }
      })
    ).not.toThrow()
    expect(() =>
      validateCatalogs({
        en: { greeting: 'Hello {name}!' },
        nb: { greeting: 'Hei!' }
      })
    ).toThrow('Placeholder mismatch for greeting')
  })

  it('includes declared inputs in plural and selector variants', () => {
    const english = {
      inbox: [
        {
          declarations: ['input count', 'local countPlural = count: plural'],
          selectors: ['countPlural'],
          match: {
            'countPlural=one': 'One message',
            'countPlural=other': '{count} messages'
          }
        }
      ]
    }
    const norwegian = {
      inbox: [
        {
          declarations: ['input count', 'local countPlural = count: plural'],
          selectors: ['countPlural'],
          match: {
            'countPlural=one': 'Én melding',
            'countPlural=other': '{count} meldinger'
          }
        }
      ]
    }
    expect(inputNames(english.inbox)).toEqual(new Set(['count']))
    expect(() =>
      validateCatalogs({
        en: flattenCatalog(english, 'en'),
        nb: flattenCatalog(norwegian, 'nb')
      })
    ).not.toThrow()
    expect(() =>
      validateCatalogs({
        en: flattenCatalog(english, 'en'),
        nb: flattenCatalog(
          { inbox: [{ declarations: ['input amount'], match: { '*': '{amount}' } }] },
          'nb'
        )
      })
    ).toThrow('Placeholder mismatch for inbox')
  })
})
