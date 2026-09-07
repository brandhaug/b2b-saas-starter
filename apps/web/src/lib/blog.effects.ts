import { type PostMeta } from './blog'

type PostModule = {
  readonly frontmatter: PostMeta['frontmatter']
}

// This glob is server-only. Metadata reads may load the compiled modules in the
// worker, but the browser receives only the serialized frontmatter projection.
const modules = import.meta.glob<PostModule>('../../content/blog/*.mdx')

function getSlugFromPath(path: string): string {
  return path.replace('../../content/blog/', '').replace('.mdx', '')
}

export async function loadAllPostMetaHandler(): Promise<ReadonlyArray<PostMeta>> {
  // oxlint-disable-next-line effect/noNewPromise -- server-only content metadata boundary; Promise.all keeps the lazy module reads parallel
  const metas = await Promise.all(
    Object.entries(modules).map(async ([path, load]) => {
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
