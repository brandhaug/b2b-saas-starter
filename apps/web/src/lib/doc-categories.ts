export const DOC_CATEGORIES = {
  'getting-started': 'Getting started',
  architecture: 'Architecture',
  'capability-interfaces': 'Capability interfaces',
  integrations: 'Integration surfaces',
  operations: 'Operations',
  governance: 'Governance'
}

export type DocCategory = keyof typeof DOC_CATEGORIES

export function isDocCategory(value: string): value is DocCategory {
  return Object.hasOwn(DOC_CATEGORIES, value)
}

export const DOC_CATEGORY_ORDER: ReadonlyArray<DocCategory> = [
  'getting-started',
  'architecture',
  'capability-interfaces',
  'integrations',
  'operations',
  'governance'
]
