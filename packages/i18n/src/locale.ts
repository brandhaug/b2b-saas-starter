/** The locales shipped by the starter. */
// oxlint-disable-next-line effect/noAs -- const tuple defines the closed locale set
export const LOCALES = ['en', 'nb'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

// Typed `unknown` so the membership test needs no string guard, and derived
// from LOCALES so adding a locale cannot leave the parser behind.
const LOCALE_VALUES: ReadonlySet<unknown> = new Set<unknown>(LOCALES)

/** True when a value is one of the locales supported by the starter. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this is the parser at the untrusted input boundary
export function isLocale(value: unknown): value is Locale {
  return LOCALE_VALUES.has(value)
}

/** The BCP 47 tag used by Intl for a starter locale. */
export function intlLocale(locale: Locale): 'en-US' | 'nb-NO' {
  if (locale === 'nb') {
    return 'nb-NO'
  }
  return 'en-US'
}

type LanguageInput = string | ReadonlyArray<string> | null | undefined

type LanguagePreference = {
  tag: string
  quality: number
  order: number
}

function languagePreferences(
  input: LanguageInput,
  startOrder = 0
): Array<LanguagePreference> {
  if (Array.isArray(input)) {
    return input.flatMap((item, index) => {
      return languagePreferences(item, startOrder + index)
    })
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- this is the type guard for an untrusted language header
  if (typeof input !== 'string') {
    return []
  }
  return input.split(',').flatMap((part, index) => {
    const [rawTag, ...parameters] = part.trim().split(';')
    const tag = rawTag?.trim().toLowerCase() ?? ''
    if (tag.length === 0 || tag === '*') {
      return []
    }
    let quality = 1
    const qualityParameter = parameters.find((parameter) =>
      /^q\s*=/i.test(parameter.trim())
    )
    if (qualityParameter) {
      const rawQuality = qualityParameter
        .slice(qualityParameter.indexOf('=') + 1)
        .trim()
      const parsedQuality = Number(rawQuality)
      // A malformed q-value must not silently become the highest preference.
      // This matters when a proxy forwards a partially malformed header: the
      // remaining valid entries should still be considered.
      if (rawQuality.length === 0 || !Number.isFinite(parsedQuality)) {
        return []
      }
      quality = Math.min(1, Math.max(0, parsedQuality))
    }
    return [{ tag, quality, order: startOrder + index }]
  })
}

/**
 * Resolve a browser or HTTP language value to a supported locale.
 *
 * `nb` and the Norwegian aliases (`no`, `nb-NO`) map to Bokmål. Unsupported,
 * empty, and wildcard-only values deliberately fall back to English.
 */
export function localeFromLanguage(input: LanguageInput): Locale {
  const preferences = languagePreferences(input)
    .filter((preference) => preference.quality > 0)
    .toSorted((left, right) => right.quality - left.quality || left.order - right.order)
  for (const { tag } of preferences) {
    const language = tag.split('-', 1)[0]
    if (language === 'nb' || language === 'no') {
      return 'nb'
    }
    if (language === 'en') {
      return 'en'
    }
  }
  return DEFAULT_LOCALE
}
