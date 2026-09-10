/**
 * Every documentation category, in the order the docs index and the
 * knowledge sidebar list them. Display names are translated by
 * `docCategoryName`; these slugs are the URL segments.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const DOC_CATEGORY_ORDER = [
  'getting-started',
  'architecture',
  'capability-interfaces',
  'integrations',
  'operations',
  'governance'
] as const

export type DocCategory = (typeof DOC_CATEGORY_ORDER)[number]

export function isDocCategory(value: string): value is DocCategory {
  return DOC_CATEGORY_ORDER.some((category) => category === value)
}
