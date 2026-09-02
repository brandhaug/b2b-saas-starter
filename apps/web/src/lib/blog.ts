import { type ComponentType } from 'react'

import { type MdxComponentProps } from '@/components/mdx-link'
import { contentJsonLd } from '@/lib/json-ld'

type BlogFrontmatter = {
  readonly title: string
  readonly description: string
  readonly date: string
  readonly author: string
  readonly tags: ReadonlyArray<string>
}

type BlogPost = {
  readonly slug: string
  readonly frontmatter: BlogFrontmatter
  readonly Component: ComponentType<MdxComponentProps>
}

const modules = import.meta.glob<{
  default: ComponentType<MdxComponentProps>
  frontmatter: BlogFrontmatter
}>('../../content/blog/*.mdx', { eager: true })

function getSlugFromPath(path: string): string {
  return path.replace('../../content/blog/', '').replace('.mdx', '')
}

const ALL_POSTS: ReadonlyArray<BlogPost> = Object.entries(modules)
  .map(([path, mod]) => ({
    slug: getSlugFromPath(path),
    frontmatter: mod.frontmatter,
    Component: mod.default
  }))
  .toSorted(
    (a, b) =>
      new Date(b.frontmatter.date).getTime() - new Date(a.frontmatter.date).getTime()
  )

const POSTS_BY_SLUG = new Map(ALL_POSTS.map((post) => [post.slug, post]))

export function getAllPosts(): ReadonlyArray<BlogPost> {
  return ALL_POSTS
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return POSTS_BY_SLUG.get(slug)
}

/** The post's structured data, beside the getter that resolves it. */
export function postJsonLd(post: BlogPost): string {
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
