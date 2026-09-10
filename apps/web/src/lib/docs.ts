import { lazy, type ComponentType } from 'react'
import { createServerFn } from '@tanstack/react-start'

import { type MdxComponentProps } from '@/components/mdx-link'
import { contentJsonLd } from '@/lib/json-ld'
import { m } from '@b2b-saas-starter/i18n/messages'
import { isDocCategory } from './doc-categories'

type DocFrontmatter = {
  readonly title: string
  readonly description: string
  readonly category: string
  readonly order: number
  readonly tags?: ReadonlyArray<string>
  readonly updated?: string
}

/**
 * Article metadata. `getDocComponent` resolves the component on demand — the
 * glob is lazy, so a route importing this module does not pull seventeen
 * compiled, shiki-highlighted articles into its chunk; the article's own
 * chunk loads when its URL is opened.
 */
export type DocMeta = {
  readonly slug: string
  readonly category: string
  readonly frontmatter: DocFrontmatter
}

type DocModule = {
  readonly default: ComponentType<MdxComponentProps>
  readonly frontmatter: DocFrontmatter
}

// No `eager`: the compiled MDX must not ride the importing route's chunk.
const modules = import.meta.glob<DocModule>('../../content/docs/**/*.mdx')

/** Server-only metadata enumeration; the browser must not import every MDX body. */
const loadAllDocMetaServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ReadonlyArray<DocMeta>> => {
    const { loadAllDocMetaHandler } = await import('./docs.effects')
    return loadAllDocMetaHandler()
  }
)

/** Module path for one doc, or `undefined` when no such article exists. */
function docPath(category: string, slug: string): string | undefined {
  const path = `../../content/docs/${category}/${slug}.mdx`
  return Object.hasOwn(modules, path) ? path : undefined
}

/**
 * The lazy loader for one doc module, or `undefined` for an unknown
 * category/slug pair — the one resolve both `loadDoc` and `getDocComponent`
 * build on.
 */
function docLoader(
  category: string,
  slug: string
): (() => Promise<DocModule>) | undefined {
  const path = docPath(category, slug)
  return path === undefined ? undefined : modules[path]
}

let metaPromise: Promise<ReadonlyArray<DocMeta>> | undefined

/** Every doc's metadata, ordered by frontmatter `order` within its category. */
export function getAllDocMeta(): Promise<ReadonlyArray<DocMeta>> {
  metaPromise ??= loadAllDocMetaServerFn()
  return metaPromise
}

/**
 * One article's metadata, via a dynamic import of its single module.
 * `undefined` for an unknown category/slug pair.
 */
export async function loadDoc(
  category: string,
  slug: string
): Promise<DocMeta | undefined> {
  const load = docLoader(category, slug)
  if (load === undefined) {
    return undefined
  }
  const mod = await load()
  return { slug, category, frontmatter: mod.frontmatter }
}

/**
 * A stable lazy component for one article, cached per path: a route renders
 * it directly — no component creation during render, and the identity is
 * stable across re-renders.
 */
export function getDocComponent(
  category: string,
  slug: string
): ComponentType<MdxComponentProps> | undefined {
  const load = docLoader(category, slug)
  if (load === undefined) {
    return undefined
  }
  let component = componentCache.get(`${category}/${slug}`)
  if (component === undefined) {
    component = lazy(async () => {
      const mod = await load()
      return { default: mod.default }
    })
    componentCache.set(`${category}/${slug}`, component)
  }
  return component
}

const componentCache = new Map<string, ComponentType<MdxComponentProps>>()

/** The display name for a category, falling back to the raw URL segment. */
export function docCategoryName(category: string): string {
  if (!isDocCategory(category)) {
    return category
  }
  switch (category) {
    case 'getting-started': {
      return m.public_docs_category_getting_started()
    }
    case 'architecture': {
      return m.public_docs_category_architecture()
    }
    case 'capability-interfaces': {
      return m.public_docs_category_capability_interfaces()
    }
    case 'integrations': {
      return m.public_docs_category_integrations()
    }
    case 'operations': {
      return m.public_docs_category_operations()
    }
    case 'governance': {
      return m.public_docs_category_governance()
    }
  }
}

/** Previous/next neighbours within a category, `null` at either end. */
export type AdjacentDocs = {
  readonly prev: DocMeta | null
  readonly next: DocMeta | null
}

export function getAdjacentDocs(
  allDocs: ReadonlyArray<DocMeta>,
  category: string,
  slug: string
): AdjacentDocs {
  const list = allDocs.filter((doc) => doc.category === category)
  const index = list.findIndex((doc) => doc.slug === slug)
  if (index === -1) {
    return { prev: null, next: null }
  }
  return {
    prev: index > 0 ? (list[index - 1] ?? null) : null,
    next: index < list.length - 1 ? (list[index + 1] ?? null) : null
  }
}

/** The article's structured data, beside the getter that resolves it. */
export function docJsonLd(article: DocMeta): string {
  const { title, description, tags } = article.frontmatter
  return contentJsonLd({
    article: {
      '@type': 'TechArticle',
      headline: title,
      description,
      keywords: (tags ?? []).join(', ')
    },
    breadcrumb: [
      m.public_home(),
      m.public_docs_title(),
      docCategoryName(article.category),
      title
    ]
  })
}
