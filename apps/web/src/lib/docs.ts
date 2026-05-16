import type { ComponentType } from 'react'

import type { MdxComponentProps } from '@/components/mdx-link'

interface DocFrontmatter {
  readonly title: string
  readonly description: string
  readonly category: string
  readonly order: number
  readonly tags?: readonly string[]
  readonly updated?: string
}

interface DocArticle {
  readonly slug: string
  readonly category: string
  readonly frontmatter: DocFrontmatter
  readonly Component: ComponentType<MdxComponentProps>
}

export const DOC_CATEGORIES = {
  'getting-started': 'Getting started',
  architecture: 'Architecture',
  'starter-modules': 'Starter modules',
  'capability-interfaces': 'Capability interfaces',
  integrations: 'Integration surfaces',
  'adoption-readiness': 'Adoption & reports',
  operations: 'Operations',
  governance: 'Governance'
} as const

export type DocCategory = keyof typeof DOC_CATEGORIES

export function isDocCategory(value: string): value is DocCategory {
  return Object.prototype.hasOwnProperty.call(DOC_CATEGORIES, value)
}

export const DOC_CATEGORY_ORDER: readonly DocCategory[] = [
  'getting-started',
  'architecture',
  'starter-modules',
  'capability-interfaces',
  'integrations',
  'adoption-readiness',
  'operations',
  'governance'
]

const modules = import.meta.glob<{
  default: ComponentType<MdxComponentProps>
  frontmatter: DocFrontmatter
}>('../../content/docs/**/*.mdx', { eager: true })

function parsePath(path: string): { category: string; slug: string } {
  const relative = path.replace('../../content/docs/', '').replace('.mdx', '')
  const parts = relative.split('/')
  return { category: parts[0] ?? '', slug: parts[parts.length - 1] ?? '' }
}

const ALL_DOCS: readonly DocArticle[] = Object.entries(modules)
  .map(([path, mod]) => {
    const { category, slug } = parsePath(path)
    return {
      slug,
      category,
      frontmatter: mod.frontmatter,
      Component: mod.default
    }
  })
  .sort((a, b) => a.frontmatter.order - b.frontmatter.order)

const DOCS_BY_CATEGORY = new Map<string, readonly DocArticle[]>()
const DOCS_BY_KEY = new Map<string, DocArticle>()
const DOC_INDEX_IN_CATEGORY = new Map<string, number>()
for (const doc of ALL_DOCS) {
  const list = DOCS_BY_CATEGORY.get(doc.category) ?? []
  DOC_INDEX_IN_CATEGORY.set(`${doc.category}/${doc.slug}`, list.length)
  DOCS_BY_CATEGORY.set(doc.category, [...list, doc])
  DOCS_BY_KEY.set(`${doc.category}/${doc.slug}`, doc)
}

export function getAllDocs(): readonly DocArticle[] {
  return ALL_DOCS
}

export function getDocsByCategory(category: string): readonly DocArticle[] {
  return DOCS_BY_CATEGORY.get(category) ?? []
}

export function getDocBySlug(category: string, slug: string): DocArticle | undefined {
  return DOCS_BY_KEY.get(`${category}/${slug}`)
}

export function getAdjacentDocs(
  category: string,
  slug: string
): { readonly prev: DocArticle | null; readonly next: DocArticle | null } {
  const list = DOCS_BY_CATEGORY.get(category)
  const index = DOC_INDEX_IN_CATEGORY.get(`${category}/${slug}`)
  if (!list || index === undefined) return { prev: null, next: null }
  return {
    prev: index > 0 ? (list[index - 1] ?? null) : null,
    next: index < list.length - 1 ? (list[index + 1] ?? null) : null
  }
}
