const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const generationalSuffix = /^(?:jr|sr|ii|iii|iv|v)\.?$/iu
const letterStart = /^\p{L}/u
// The Arabic definite article: "الرحمن" is initialled by its ر, not the alif.
const arabicArticle = /^ال(?=\p{L}{2})/u

function firstGrapheme(word: string): string {
  return graphemes.segment(word.replace(arabicArticle, '')).containing(0)?.segment ?? ''
}

/**
 * Up to two initials for a display name: the first grapheme of the first and
 * last words that start with a letter, skipping generational suffixes and an
 * Arabic definite article. Whole
 * graphemes keep "Đặng" and "李小龍" intact where `charAt(0)` splits a
 * surrogate pair; skipping non-letter words keeps an emoji prefix out of the
 * badge. A name with no letter-led word yields `''`.
 */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => letterStart.test(word) && !generationalSuffix.test(word))
  const first = words.at(0)
  if (first === undefined) {
    return ''
  }
  const last = words.length > 1 ? words.at(-1) : undefined
  return `${firstGrapheme(first)}${last === undefined ? '' : firstGrapheme(last)}`.toLocaleUpperCase()
}
