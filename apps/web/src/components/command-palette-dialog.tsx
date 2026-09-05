import { use, type ReactNode } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { BookOpenIcon } from 'lucide-react'
import { getAllPostMeta } from '@/lib/blog'
import { getAllDocMeta } from '@/lib/docs'
import { publicLinks } from '@/lib/content'
import { viewerCan } from '@/lib/permissions'
import { WORKSPACE_NAV, YOU_NAV } from '@/lib/workspace-nav'
import { CommandPaletteContext } from '@/lib/command-palette-context'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'

// The knowledge index the palette searches: both meta loaders are cached
// promises (lib/docs.ts, lib/blog.ts), so this starts once when the lazy
// dialog chunk loads and `use` suspends on the same instance every open.
// oxlint-disable effect/noNewPromise -- this module is the promise boundary between the palette (react) and the Effect-native content; same exemption as lib/docs.ts
const knowledgeMeta = Promise.all([getAllDocMeta(), getAllPostMeta()])

/** The palette's context value, flattened for the dialog's two consumers. */
function usePaletteSession() {
  const value = use(CommandPaletteContext)
  return {
    viewer: value?.viewer ?? null,
    systemRole: value?.systemRole ?? null
  }
}

/**
 * Docs and blog titles/descriptions as one searchable group — the promise is
 * the cached meta index, so opening the palette neither re-reads nor ships
 * article bodies.
 */
function KnowledgeEntries({ close }: { readonly close: () => void }) {
  const navigate = useNavigate()
  const [docs, posts] = use(knowledgeMeta)
  return (
    <CommandGroup heading="Knowledge">
      {docs.map((doc) => (
        <CommandItem
          key={`docs/${doc.category}/${doc.slug}`}
          keywords={[doc.frontmatter.description, doc.category]}
          onSelect={() => {
            close()
            void navigate({
              to: '/docs/$category/$slug',
              params: { category: doc.category, slug: doc.slug }
            })
          }}
        >
          <BookOpenIcon aria-hidden className="size-4" />
          {doc.frontmatter.title}
        </CommandItem>
      ))}
      {posts.map((post) => (
        <CommandItem
          key={`blog/${post.slug}`}
          keywords={[post.frontmatter.description]}
          onSelect={() => {
            close()
            void navigate({ to: '/blog/$slug', params: { slug: post.slug } })
          }}
        >
          <BookOpenIcon aria-hidden className="size-4" />
          {post.frontmatter.title}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

/**
 * The command palette's dialog, split from `command-palette.tsx` so cmdk and
 * its dependencies stay out of the entry chunk: this module is loaded only
 * when the palette opens (or is preloaded on search-button hover/focus).
 *
 * Workspace entries come from the same `WORKSPACE_NAV` table the sidebar
 * renders, and the user-level entries from its `YOU_NAV` twin, both filtered
 * the way the sidebar filters — the palette and the sidebar cannot drift, and
 * a member is never offered a section their role cannot open. The admin
 * entry renders only for a system admin, who is the only role the route lets
 * through.
 */
// Loaded via dynamic import() in command-palette-loader.ts.
// fallow-ignore-next-line unused-export
export default function CommandPaletteDialog({
  open,
  onOpenChange
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  // Target the current workspace when inside one; outside a workspace the
  // command falls back to the workspace list — never a hardcoded workspace.
  const params = useParams({ strict: false })
  const workspaceSlug = params.workspaceSlug
  const { viewer, systemRole } = usePaletteSession()

  function close() {
    onOpenChange(false)
  }

  const rows: Array<ReactNode> = []
  if (workspaceSlug !== undefined && viewer !== null) {
    for (const row of WORKSPACE_NAV) {
      if (row.permission !== undefined && !viewerCan(viewer, row.permission)) {
        continue
      }
      const to = row.to
      rows.push(
        <CommandItem
          key={row.to}
          // Grouped rows match their section name too — the sidebar says
          // "General", the palette still answers "settings".
          {...(row.group === undefined ? {} : { keywords: [row.group] })}
          onSelect={() => {
            close()
            void navigate({ to, params: { workspaceSlug } })
          }}
        >
          {row.label}
        </CommandItem>
      )
    }
  } else {
    rows.push(
      <CommandItem
        key="workspaces"
        onSelect={() => {
          close()
          void navigate({ to: '/workspaces' })
        }}
      >
        Open workspaces
      </CommandItem>
    )
  }
  // The user-level rows from the same `YOU_NAV` table the sidebar renders:
  // label, target, and the admin-only gate cannot drift between the two.
  for (const row of YOU_NAV) {
    if (row.adminOnly === true && systemRole !== 'admin') {
      continue
    }
    rows.push(
      <CommandItem
        key={row.to}
        {...(row.group === undefined ? {} : { keywords: [row.group] })}
        onSelect={() => {
          close()
          void navigate({ to: row.to })
        }}
      >
        {row.icon}
        {row.label}
      </CommandItem>
    )
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search docs, pages, and actions…"
        aria-label="Search docs, pages, and actions"
      />
      <CommandList>
        <CommandEmpty>No result found.</CommandEmpty>
        <CommandGroup heading="Public pages">
          {publicLinks.map((link) => (
            <CommandItem
              key={link.to}
              onSelect={() => {
                close()
                void navigate({ to: link.to })
              }}
            >
              {link.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {/* Suspends on the cached meta index the first time it opens — the
            provider already wraps the dialog in a Suspense boundary. */}
        <KnowledgeEntries close={close} />
        <CommandGroup heading="Workspace">{rows}</CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
