import { type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { use, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { BookOpenIcon } from 'lucide-react'
import { getAllDocMeta } from '@/lib/docs'
import { publicLinks } from '@/lib/content'
import { viewerCan } from '@/lib/permissions'
import { workspaceNav, youNav, type WorkspaceNavTarget } from '@/lib/workspace-nav'
import { CommandPaletteContext } from '@/lib/command-palette-context'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { usePreview } from '@/lib/preview-context'
import { previewWorkspaceLocation } from '@/lib/preview-navigation'
import { m } from '@b2b-saas-starter/i18n/messages'

// The knowledge index the palette searches: both meta loaders are cached
// promise (lib/docs.ts), so this starts once when the lazy
// dialog chunk loads and `use` suspends on the same instance every open.
const knowledgeMeta = getAllDocMeta()

/**
 * Doc titles and descriptions as one searchable group — the promise is
 * the cached meta index, so opening the palette neither re-reads nor ships
 * article bodies.
 */
function KnowledgeEntries({ close }: { readonly close: () => void }) {
  const navigate = useNavigate()
  const docs = use(knowledgeMeta)
  return (
    <CommandGroup heading={m.knowledge()}>
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
export default function CommandPaletteDialog() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  // Target the current workspace when inside one; outside a workspace the
  // command falls back to the workspace list — never a hardcoded workspace.
  const params = useParams({ strict: false })
  const workspaceSlug = params.workspaceSlug
  const preview = usePreview()
  const palette = use(CommandPaletteContext)
  if (palette === null) {
    return null
  }
  const { open, setOpen, viewer, systemRole } = palette

  function close() {
    setOpen(false)
  }

  const rows: Array<ReactNode> = []
  if ((preview || workspaceSlug !== undefined) && viewer !== null) {
    for (const row of workspaceNav()) {
      if (row.permission !== undefined && !viewerCan(viewer, row.permission)) {
        continue
      }
      const to = row.to
      rows.push(
        <CommandItem
          key={row.to}
          // Match section labels as well as destination names.
          {...(row.group === undefined ? {} : { keywords: [row.group] })}
          onSelect={() => {
            close()
            if (preview) {
              void navigate(previewWorkspaceLocation(to))
            } else if (workspaceSlug !== undefined) {
              void navigate({ to, params: { workspaceSlug } })
            }
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
        {m.open_workspaces()}
      </CommandItem>
    )
  }
  // The user-level rows from the same `YOU_NAV` table the sidebar renders:
  // label, target, and the admin-only gate cannot drift between the two.
  for (const row of youNav()) {
    if (row.adminOnly === true && (preview || systemRole !== 'admin')) {
      continue
    }
    rows.push(
      <CommandItem
        key={row.to}
        {...(row.group === undefined ? {} : { keywords: [row.group] })}
        onSelect={() => {
          close()
          void navigate({ to: preview && row.to === '/account' ? '/sign-in' : row.to })
        }}
      >
        {row.icon}
        {preview && row.to === '/account' ? m.demo_try_sign_in() : row.label}
      </CommandItem>
    )
  }

  const actions =
    viewer === null
      ? []
      : ([
          {
            label: m.form_invite_member(),
            to: '/workspaces/$workspaceSlug/members',
            action: 'invite',
            permission: { invitation: ['create'] }
          },
          {
            label: m.tokens_create_title(),
            to: '/workspaces/$workspaceSlug/api-tokens',
            action: 'create',
            permission: { apiToken: ['create'] }
          },
          {
            label: m.register_endpoint(),
            to: '/workspaces/$workspaceSlug/webhooks',
            action: 'create',
            permission: { webhook: ['create'] }
          }
        ] satisfies ReadonlyArray<{
          label: string
          to: WorkspaceNavTarget
          action: string
          permission: PermissionRequest
        }>)

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={m.command_search_placeholder()}
        aria-label={m.command_search_label()}
      />
      <CommandList>
        <CommandEmpty>{m.command_no_results()}</CommandEmpty>
        {(preview || workspaceSlug !== undefined) && viewer !== null ? (
          <CommandGroup heading={m.workspace_actions()}>
            {query.trim() === '' ? null : (
              <CommandItem
                onSelect={() => {
                  close()
                  const location = preview
                    ? previewWorkspaceLocation('/workspaces/$workspaceSlug/members')
                    : {
                        to: '/workspaces/$workspaceSlug/members' satisfies WorkspaceNavTarget,
                        params: { workspaceSlug: workspaceSlug ?? '' }
                      }
                  void navigate({
                    ...location,
                    search: { query: query.trim(), tab: 'members' }
                  })
                }}
              >
                {m.workspace_find_members({ query: query.trim() })}
              </CommandItem>
            )}
            {actions.map((action) =>
              viewerCan(viewer, action.permission) ? (
                <CommandItem
                  key={action.action + action.to}
                  onSelect={() => {
                    close()
                    const location = preview
                      ? previewWorkspaceLocation(action.to)
                      : {
                          to: action.to,
                          params: { workspaceSlug: workspaceSlug ?? '' }
                        }
                    void navigate({ ...location, search: { action: action.action } })
                  }}
                >
                  {action.label}
                </CommandItem>
              ) : null
            )}
          </CommandGroup>
        ) : null}
        <CommandGroup heading={m.nav_workspace_group()}>{rows}</CommandGroup>
        <KnowledgeEntries close={close} />
        <CommandGroup heading={m.command_public_pages()}>
          {publicLinks().map((link) => (
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
      </CommandList>
    </CommandDialog>
  )
}
