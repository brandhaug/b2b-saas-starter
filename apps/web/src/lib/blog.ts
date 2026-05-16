import type { ComponentType } from 'react'

import type { MdxComponentProps } from '@/components/mdx-link'

interface BlogFrontmatter {
  readonly title: string
  readonly description: string
  readonly date: string
  readonly author: string
  readonly tags: readonly string[]
}

interface BlogPost {
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

const ALL_POSTS: readonly BlogPost[] = Object.entries(modules)
  .map(([path, mod]) => ({
    slug: getSlugFromPath(path),
    frontmatter: mod.frontmatter,
    Component: mod.default
  }))
  .sort(
    (a, b) =>
      new Date(b.frontmatter.date).getTime() - new Date(a.frontmatter.date).getTime()
  )

const POSTS_BY_SLUG = new Map(ALL_POSTS.map((post) => [post.slug, post]))

export function getAllPosts(): readonly BlogPost[] {
  return ALL_POSTS
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return POSTS_BY_SLUG.get(slug)
}
