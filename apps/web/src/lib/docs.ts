import { type ComponentType } from 'react'

import { type MdxComponentProps } from '@/components/mdx-link'
import { contentJsonLd } from '@/lib/json-ld'

type DocFrontmatter = {
  readonly title: string
  readonly description: string
  readonly category: string
  readonly order: number
  readonly tags?: ReadonlyArray<string>
  readonly updated?: string
}

type DocArticle = {
  readonly slug: string
  readonly category: string
  readonly frontmatter: DocFrontmatter
  readonly Component: ComponentType<MdxComponentProps>
}

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

/** The display name for a category, falling back to the raw URL segment. */
export function docCategoryName(category: string): string {
  return isDocCategory(category) ? DOC_CATEGORIES[category] : category
}

export const DOC_CATEGORY_ORDER: ReadonlyArray<DocCategory> = [
  'getting-started',
  'architecture',
  'capability-interfaces',
  'integrations',
  'operations',
  'governance'
]

const modules = import.meta.glob<{
  default: ComponentType<MdxComponentProps>
  frontmatter: DocFrontmatter
}>('../../content/docs/**/*.mdx', { eager: true })

/** The two path segments a docs module's file path encodes. */
type DocPath = { category: string; slug: string }

function parsePath(path: string): DocPath {
  const relative = path.replace('../../content/docs/', '').replace('.mdx', '')
  const parts = relative.split('/')
  return { category: parts[0] ?? '', slug: parts.at(-1) ?? '' }
}

const ALL_DOCS: ReadonlyArray<DocArticle> = Object.entries(modules)
  .map(([path, mod]) => {
    const { category, slug } = parsePath(path)
    return {
      slug,
      category,
      frontmatter: mod.frontmatter,
      Component: mod.default
    }
  })
  .toSorted((a, b) => a.frontmatter.order - b.frontmatter.order)

const DOCS_BY_CATEGORY = new Map<string, ReadonlyArray<DocArticle>>()
const DOCS_BY_KEY = new Map<string, DocArticle>()
const DOC_INDEX_IN_CATEGORY = new Map<string, number>()
for (const doc of ALL_DOCS) {
  const list = DOCS_BY_CATEGORY.get(doc.category) ?? []
  DOC_INDEX_IN_CATEGORY.set(`${doc.category}/${doc.slug}`, list.length)
  DOCS_BY_CATEGORY.set(doc.category, [...list, doc])
  DOCS_BY_KEY.set(`${doc.category}/${doc.slug}`, doc)
}

export function getAllDocs(): ReadonlyArray<DocArticle> {
  return ALL_DOCS
}

export function getDocsByCategory(category: string): ReadonlyArray<DocArticle> {
  return DOCS_BY_CATEGORY.get(category) ?? []
}

export function getDocBySlug(category: string, slug: string): DocArticle | undefined {
  return DOCS_BY_KEY.get(`${category}/${slug}`)
}

/** Previous/next neighbours within a category, `null` at either end. */
export type AdjacentDocs = {
  readonly prev: DocArticle | null
  readonly next: DocArticle | null
}

export function getAdjacentDocs(category: string, slug: string): AdjacentDocs {
  const list = DOCS_BY_CATEGORY.get(category)
  const index = DOC_INDEX_IN_CATEGORY.get(`${category}/${slug}`)
  if (!list || index === undefined) {
    return { prev: null, next: null }
  }
  return {
    prev: index > 0 ? (list[index - 1] ?? null) : null,
    next: index < list.length - 1 ? (list[index + 1] ?? null) : null
  }
}

/** The article's structured data, beside the getter that resolves it. */
export function docJsonLd(article: DocArticle): string {
  const { title, description, tags } = article.frontmatter
  return contentJsonLd({
    article: {
      '@type': 'TechArticle',
      headline: title,
      description,
      keywords: (tags ?? []).join(', ')
    },
    breadcrumb: ['Home', 'Documentation', docCategoryName(article.category), title]
  })
}
