import { lazy, type ComponentType } from 'react'
import { createServerFn } from '@tanstack/react-start'

import { type MdxComponentProps } from '@/components/mdx-link'
import { contentJsonLd } from '@/lib/json-ld'
import { m } from '@b2b-saas-starter/i18n/messages'

type BlogFrontmatter = {
  readonly title: string
  readonly description: string
  readonly date: string
  readonly author: string
  readonly tags: ReadonlyArray<string>
}

/**
 * Post metadata. `getPostComponent` resolves the component on demand — the
 * glob is lazy, so the compiled (and highlighted) MDX never rides the
 * importing route's chunk; the post's own chunk loads when its URL is opened.
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
const modules = import.meta.glob<PostModule>('../../content/blog/*.mdx')

/** Server-only metadata enumeration; the browser must not import every MDX body. */
const loadAllPostMetaServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ReadonlyArray<PostMeta>> => {
    const { loadAllPostMetaHandler } = await import('./blog.effects')
    return loadAllPostMetaHandler()
  }
)

let metaPromise: Promise<ReadonlyArray<PostMeta>> | undefined

/** Every post's metadata, newest first. */
export function getAllPostMeta(): Promise<ReadonlyArray<PostMeta>> {
  metaPromise ??= loadAllPostMetaServerFn()
  return metaPromise
}

/**
 * The lazy loader for one post module, or `undefined` for an unknown slug —
 * the one resolve both `loadPost` and `getPostComponent` build on.
 */
function postLoader(slug: string): (() => Promise<PostModule>) | undefined {
  const path = `../../content/blog/${slug}.mdx`
  return Object.hasOwn(modules, path) ? modules[path] : undefined
}

/** One post's metadata, or `undefined` for an unknown slug. */
export async function loadPost(slug: string): Promise<PostMeta | undefined> {
  const load = postLoader(slug)
  if (load === undefined) {
    return undefined
  }
  const mod = await load()
  return { slug, frontmatter: mod.frontmatter }
}

/**
 * A stable lazy component for one post's component, cached per path: a
 * route renders it directly — no component creation during render, and the
 * identity is stable across re-renders.
 */
export function getPostComponent(
  slug: string
): ComponentType<MdxComponentProps> | undefined {
  const load = postLoader(slug)
  if (load === undefined) {
    return undefined
  }
  let component = componentCache.get(slug)
  if (component === undefined) {
    component = lazy(async () => {
      const mod = await load()
      return { default: mod.default }
    })
    componentCache.set(slug, component)
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
    breadcrumb: [m.public_home(), m.public_blog_title(), title]
  })
}
