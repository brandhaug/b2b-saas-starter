import { Link } from '@tanstack/react-router'

/** The knowledge shell's sections. Changelog is not one: /changelog redirects
 *  to the repository's GitHub Releases, where release-please publishes what
 *  Conventional Commits produce (see routes/_knowledge.changelog.tsx). */
export type KnowledgeSection = 'docs' | 'blog' | 'faq'

const SECTIONS: ReadonlyArray<{
  readonly id: KnowledgeSection
  readonly to: '/docs' | '/blog' | '/faq'
  readonly label: string
}> = [
  { id: 'docs', to: '/docs', label: 'Docs' },
  { id: 'blog', to: '/blog', label: 'Blog' },
  { id: 'faq', to: '/faq', label: 'FAQ' }
]

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
            {section.label}
          </Link>
        </li>
      ))}
    </ul>
  )
}
