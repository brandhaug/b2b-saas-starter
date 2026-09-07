import { DOC_CATEGORY_ORDER, type DocCategory, isDocCategory } from './doc-categories'
import { type DocMeta } from './docs'

type DocModule = {
  readonly frontmatter: DocMeta['frontmatter']
}

// This glob is server-only. Metadata reads may load the compiled modules in the
// worker, but the browser receives only the serialized frontmatter projection.
const modules = import.meta.glob<DocModule>('../../content/docs/**/*.mdx')

type DocPath = { category: string; slug: string }

function parsePath(path: string): DocPath {
  const relative = path.replace('../../content/docs/', '').replace('.mdx', '')
  const parts = relative.split('/')
  return { category: parts[0] ?? '', slug: parts.at(-1) ?? '' }
}

function asCategory(value: string): DocCategory {
  return isDocCategory(value) ? value : 'getting-started'
}

export async function loadAllDocMetaHandler(): Promise<ReadonlyArray<DocMeta>> {
  // oxlint-disable-next-line effect/noNewPromise -- server-only content metadata boundary; Promise.all keeps the lazy module reads parallel
  const metas = await Promise.all(
    Object.entries(modules).map(async ([path, load]) => {
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
