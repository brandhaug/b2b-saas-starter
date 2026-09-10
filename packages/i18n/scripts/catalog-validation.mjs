function isObject(value) {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- JSON values are narrowed at this parser boundary
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Merge one source catalog while rejecting keys claimed by two domains. */
export function mergeInto(target, source, path = '') {
  for (const [key, value] of Object.entries(source)) {
    const keyPath = path === '' ? key : `${path}.${key}`
    if (!(key in target)) {
      target[key] = value
      continue
    }
    const existing = target[key]
    if (isObject(existing) && isObject(value)) {
      mergeInto(existing, value, keyPath)
      continue
    }
    throw new Error(`Duplicate translation key: ${keyPath}`)
  }
  return target
}

function leafEntries(value, path = '') {
  if (!isObject(value)) {
    return [[path, value]]
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leafEntries(child, path === '' ? key : `${path}.${key}`)
  )
}

function identifierForMessageKey(key) {
  const identifier = key.replaceAll(/[^A-Za-z0-9_$]/gu, '_')
  return /^[A-Za-z_$]/u.test(identifier) ? identifier : `_${identifier}`
}

/**
 * Return all message inputs, including `{name}` placeholders and `input name`
 * declarations used by MessageFormat variant messages.
 */
export function inputNames(value) {
  const names = new Set()
  collectInputNames(value, names)
  return names
}

function collectInputNames(value, names) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectInputNames(item, names)
    }
    return
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'declarations' && Array.isArray(child)) {
        for (const declaration of child) {
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- declarations originate in parsed JSON and need a string guard before regex parsing
          if (typeof declaration !== 'string') {
            continue
          }
          const input = /^input\s+([A-Za-z_][A-Za-z0-9_.-]*)\b/u.exec(declaration)
          if (input !== null) {
            names.add(input[1])
          }
        }
      }
      collectInputNames(child, names)
    }
    return
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- catalog values are narrowed before placeholder extraction
  if (typeof value !== 'string') {
    return
  }
  for (const match of value.matchAll(/(?<!\\)\{([A-Za-z_][A-Za-z0-9_.-]*)\}/gu)) {
    names.add(match[1])
  }
}

/** Flatten nested catalog keys to the identifiers emitted by Paraglide. */
export function flattenCatalog(catalog, locale) {
  const flattened = {}
  for (const [key, value] of leafEntries(catalog)) {
    const identifier = identifierForMessageKey(key)
    if (identifier in flattened) {
      throw new Error(`Message key alias collision in ${locale}: ${key}`)
    }
    flattened[identifier] = value
  }
  return flattened
}

function sortedNames(names) {
  return [...names].toSorted((left, right) => left.localeCompare(right))
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

/** Enforce locale key parity and input parity for every flattened message. */
export function validateCatalogs(catalogs, baseLocale = 'en', translatedLocale = 'nb') {
  const baseEntries = new Map(Object.entries(catalogs[baseLocale]))
  const translatedEntries = new Map(Object.entries(catalogs[translatedLocale]))

  for (const [key, value] of baseEntries) {
    if (!translatedEntries.has(key)) {
      throw new Error(`Missing ${translatedLocale} translation for ${key}`)
    }
    const translated = translatedEntries.get(key)
    const expected = inputNames(value)
    const actual = inputNames(translated)
    if (!sameSet(expected, actual)) {
      throw new Error(
        `Placeholder mismatch for ${key}: ${baseLocale}=${sortedNames(expected).join(',')} ${translatedLocale}=${sortedNames(actual).join(',')}`
      )
    }
  }
  for (const key of translatedEntries.keys()) {
    if (!baseEntries.has(key)) {
      throw new Error(`Missing ${baseLocale} translation for ${key}`)
    }
  }
}

/**
 * The inlang project must declare exactly the locales `src/locale.ts` does.
 * They are two files a compile step reads separately: a locale added to one
 * and not the other produces a catalog nobody validates, or a compiled runtime
 * for a locale the parser rejects.
 */
export function validateProjectLocales(settings, locales) {
  const declared = settings.locales
  if (!Array.isArray(declared)) {
    throw new TypeError('project.inlang/settings.json declares no `locales` array')
  }
  const expected = [...locales].toSorted((left, right) => left.localeCompare(right))
  const actual = [...declared].toSorted((left, right) => left.localeCompare(right))
  if (expected.join(',') !== actual.join(',')) {
    throw new Error(
      `Locale mismatch: src/locale.ts has ${expected.join(',')}, project.inlang/settings.json has ${actual.join(',')}`
    )
  }
  if (!locales.includes(settings.baseLocale)) {
    throw new Error(
      `project.inlang/settings.json baseLocale ${String(settings.baseLocale)} is not one of ${expected.join(',')}`
    )
  }
}
