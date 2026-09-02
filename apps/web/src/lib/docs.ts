import { lazy, type ComponentType } from 'react'

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

/**
 * Article metadata. `loadDoc` resolves the component on demand — the glob is
 * lazy, so a route importing this module does not pull seventeen compiled,
 * shiki-highlighted articles into its chunk; the article's own chunk loads
 * when its URL is opened.
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
// oxlint-disable effect/noNewPromise -- this module is the promise boundary between router loaders (promise-shaped) and the Effect-native content; same exemption as packages/logger/src/providers.ts
const modules = import.meta.glob<DocModule>('../../content/docs/**/*.mdx')

/** The two path segments a docs module's file path encodes. */
type DocPath = { category: string; slug: string }

function parsePath(path: string): DocPath {
  const relative = path.replace('../../content/docs/', '').replace('.mdx', '')
  const parts = relative.split('/')
  return { category: parts[0] ?? '', slug: parts.at(-1) ?? '' }
}

/** Module path for one doc, or `undefined` when no such article exists. */
function docPath(category: string, slug: string): string | undefined {
  const path = `../../content/docs/${category}/${slug}.mdx`
  return Object.hasOwn(modules, path) ? path : undefined
}

let metaPromise: Promise<ReadonlyArray<DocMeta>> | undefined

async function loadAllDocMeta(): Promise<ReadonlyArray<DocMeta>> {
  const entries = Object.entries(modules)
  const metas = await Promise.all(
    entries.map(async ([path, load]) => {
      const { category, slug } = parsePath(path)
      const mod = await load()
      return { slug, category, frontmatter: mod.frontmatter } satisfies DocMeta
    })
  )
  return metas.toSorted((a, b) =>
    a.category === b.category
      ? a.frontmatter.order - b.frontmatter.order
      : DOC_CATEGORY_ORDER.indexOf(asCategory(a.category)) -
        DOC_CATEGORY_ORDER.indexOf(asCategory(b.category))
  )
}

/** Every doc's metadata, ordered by frontmatter `order` within its category. */
export function getAllDocMeta(): Promise<ReadonlyArray<DocMeta>> {
  metaPromise ??= loadAllDocMeta()
  return metaPromise
}

function asCategory(value: string): DocCategory {
  return isDocCategory(value) ? value : 'getting-started'
}

export type LoadedDoc = DocMeta & {
  readonly Component: ComponentType<MdxComponentProps>
}

/**
 * One article — metadata plus the component — via a dynamic import of its
 * single module. `undefined` for an unknown category/slug pair.
 */
export async function loadDoc(
  category: string,
  slug: string
): Promise<LoadedDoc | undefined> {
  const path = docPath(category, slug)
  const load = path === undefined ? undefined : modules[path]
  if (load === undefined) {
    return undefined
  }
  const mod = await load()
  return { slug, category, frontmatter: mod.frontmatter, Component: mod.default }
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
  const resolved = docPath(category, slug)
  const load = resolved === undefined ? undefined : modules[resolved]
  if (resolved === undefined || load === undefined) {
    return undefined
  }
  let component = componentCache.get(resolved)
  if (component === undefined) {
    component = lazy(async () => {
      const mod = await load()
      return { default: mod.default }
    })
    componentCache.set(resolved, component)
  }
  return component
}

const componentCache = new Map<string, ComponentType<MdxComponentProps>>()

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
    breadcrumb: ['Home', 'Documentation', docCategoryName(article.category), title]
  })
}
