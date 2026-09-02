import { lazy, type ComponentType } from 'react'

import { type MdxComponentProps } from '@/components/mdx-link'
import { contentJsonLd } from '@/lib/json-ld'

type BlogFrontmatter = {
  readonly title: string
  readonly description: string
  readonly date: string
  readonly author: string
  readonly tags: ReadonlyArray<string>
}

/**
 * Post metadata. `loadPost` resolves the component on demand — the glob is
 * lazy, so the compiled (and highlighted) MDX never rides the importing
 * route's chunk; the post's own chunk loads when its URL is opened.
 */
export type PostMeta = {
  readonly slug: string
  readonly frontmatter: BlogFrontmatter
}

type PostModule = {
  readonly default: ComponentType<MdxComponentProps>
  readonly frontmatter: BlogFrontmatter
}

// No `eager`: the compiled MDX must not ride the importing route's chunk.
// oxlint-disable effect/noNewPromise -- this module is the promise boundary between router loaders (promise-shaped) and the Effect-native content; same exemption as packages/logger/src/providers.ts
const modules = import.meta.glob<PostModule>('../../content/blog/*.mdx')

function getSlugFromPath(path: string): string {
  return path.replace('../../content/blog/', '').replace('.mdx', '')
}

let metaPromise: Promise<ReadonlyArray<PostMeta>> | undefined

async function loadAllPostMeta(): Promise<ReadonlyArray<PostMeta>> {
  const entries = Object.entries(modules)
  const metas = await Promise.all(
    entries.map(async ([path, load]) => {
      const mod = await load()
      return {
        slug: getSlugFromPath(path),
        frontmatter: mod.frontmatter
      } satisfies PostMeta
    })
  )
  return metas.toSorted(
    (a, b) =>
      new Date(b.frontmatter.date).getTime() - new Date(a.frontmatter.date).getTime()
  )
}

/** Every post's metadata, newest first. */
export function getAllPostMeta(): Promise<ReadonlyArray<PostMeta>> {
  metaPromise ??= loadAllPostMeta()
  return metaPromise
}

export type LoadedPost = PostMeta & {
  readonly Component: ComponentType<MdxComponentProps>
}

/** One post — metadata plus the component — or `undefined` for an unknown slug. */
export async function loadPost(slug: string): Promise<LoadedPost | undefined> {
  const path = `../../content/blog/${slug}.mdx`
  const load = Object.hasOwn(modules, path) ? modules[path] : undefined
  if (load === undefined) {
    return undefined
  }
  const mod = await load()
  return { slug, frontmatter: mod.frontmatter, Component: mod.default }
}

/**
 * A stable lazy component for one post's component, cached per path: a
 * route renders it directly — no component creation during render, and the
 * identity is stable across re-renders.
 */
export function getPostComponent(
  slug: string
): ComponentType<MdxComponentProps> | undefined {
  const path = `../../content/blog/${slug}.mdx`
  const load = Object.hasOwn(modules, path) ? modules[path] : undefined
  if (load === undefined) {
    return undefined
  }
  let component = componentCache.get(path)
  if (component === undefined) {
    component = lazy(async () => {
      const mod = await load()
      return { default: mod.default }
    })
    componentCache.set(path, component)
  }
  return component
}

const componentCache = new Map<string, ComponentType<MdxComponentProps>>()

/** The post's structured data, beside the getter that resolves it. */
export function postJsonLd(post: PostMeta): string {
  const { title, description, date, author, tags } = post.frontmatter
  return contentJsonLd({
    article: {
      '@type': 'BlogPosting',
      headline: title,
      description,
      datePublished: date,
      author: { '@type': 'Organization', name: author },
      keywords: tags.join(', ')
    },
    breadcrumb: ['Home', 'Blog', title]
  })
}
