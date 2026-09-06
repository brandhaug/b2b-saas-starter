import { Link } from '@tanstack/react-router'
import { m } from '@b2b-saas-starter/i18n/messages'

/** The knowledge shell's sections. Changelog is not one: /changelog redirects
 *  to the repository's GitHub Releases, where release-please publishes what
 *  Conventional Commits produce (see routes/_knowledge.changelog.tsx). */
export type KnowledgeSection = 'docs' | 'blog' | 'faq'

const SECTIONS: ReadonlyArray<{
  readonly id: KnowledgeSection
  readonly to: '/docs' | '/blog' | '/faq'
}> = [
  { id: 'docs', to: '/docs' },
  { id: 'blog', to: '/blog' },
  { id: 'faq', to: '/faq' }
]

function sectionLabel(section: KnowledgeSection): string {
  switch (section) {
    case 'docs': {
      return m.public_docs_title()
    }
    case 'blog': {
      return m.public_blog_title()
    }
    case 'faq': {
      return m.public_faq_title()
    }
  }
}

/** The one active/inactive treatment for the section switcher segments. */
function switcherClasses(isActive: boolean): string {
  return isActive
    ? 'block w-full rounded-sm bg-muted px-2 py-1.5 text-center text-xs font-medium text-foreground'
    : 'block w-full rounded-sm px-2 py-1.5 text-center text-xs text-muted-foreground transition-colors hover:text-foreground'
}

/**
 * The pinned section switcher: a compact segmented control at the top of the
 * knowledge sidebar. A reader on /blog (or deep in a post) sees the blog
 * section below it and can move to docs or FAQ without scrolling past a docs
 * index.
 */
export function SectionSwitcher({ current }: { readonly current: KnowledgeSection }) {
  return (
    <ul className="grid grid-cols-3 gap-0.5 rounded-md border border-border p-0.5">
      {SECTIONS.map((section) => (
        <li key={section.id}>
          <Link
            to={section.to}
            aria-current={section.id === current ? 'true' : undefined}
            className={switcherClasses(section.id === current)}
          >
            {sectionLabel(section.id)}
          </Link>
        </li>
      ))}
    </ul>
  )
}
