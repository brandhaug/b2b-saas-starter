import {
  type ModuleStatus,
  type StarterModuleWithState
} from '@b2b-saas-starter/capabilities'

type StatusMeta = { readonly dot: string; readonly text: string }

const DISABLED_STATUS_META: StatusMeta = {
  dot: 'border border-muted-foreground/70 bg-transparent',
  text: 'text-muted-foreground'
}

// Keyed by `ModuleStatus` rather than `string`: the catalog's status union is
// closed, so adding a status to it fails here instead of silently falling back.
const MODULE_STATUS_META = {
  ready: { dot: 'bg-primary', text: 'text-foreground' },
  'needs-config': { dot: 'bg-signal', text: 'text-signal-ink' },
  attention: { dot: 'bg-destructive', text: 'text-destructive' },
  disabled: DISABLED_STATUS_META
} satisfies Record<ModuleStatus, StatusMeta>

function ModuleManifestSection({
  workspaceSlug,
  modules
}: {
  readonly workspaceSlug: string
  readonly modules: readonly StarterModuleWithState[]
}) {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-20 pb-24 sm:px-6 lg:pt-28">
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-4">
        <h2 className="max-w-md text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          {modules.length} starter modules, read live.
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Read at request time from the{' '}
          <span className="font-mono text-signal-ink">{workspaceSlug}</span> seed
          workspace, through the same capability layer the reference app uses.
        </p>
      </div>
      <table className="mt-10 w-full border-t border-border text-left">
        <caption className="sr-only">
          Starter modules and their current module state in the seed workspace
        </caption>
        <thead>
          <tr className="border-b border-border font-mono text-xs text-muted-foreground">
            <th scope="col" className="w-10 py-2 pr-4 font-normal max-sm:hidden">
              #
            </th>
            <th scope="col" className="py-2 pr-4 font-normal">
              module
            </th>
            <th scope="col" className="py-2 pr-4 font-normal max-md:hidden">
              category
            </th>
            <th scope="col" className="py-2 font-normal">
              state
            </th>
          </tr>
        </thead>
        <tbody>
          {modules.map((module, index) => {
            const meta = MODULE_STATUS_META[module.state.status]
            return (
              <tr
                key={module.id}
                className="border-b border-border transition-colors hover:bg-accent/40"
              >
                <td className="py-3.5 pr-4 font-mono text-xs text-muted-foreground max-sm:hidden">
                  {String(index + 1).padStart(2, '0')}
                </td>
                <td className="max-w-xl py-3.5 pr-4">
                  <p className="text-sm font-medium">{module.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {module.summary}
                  </p>
                </td>
                <td className="py-3.5 pr-4 text-xs text-muted-foreground max-md:hidden">
                  {module.category}
                </td>
                {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the status text is right here, one span deep */}
                <td className="py-3.5">
                  <span className="inline-flex items-center gap-2">
                    <span className={`size-2 shrink-0 ${meta.dot}`} />
                    <span className={`font-mono text-xs ${meta.text}`}>
                      {module.state.status}
                    </span>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

export { ModuleManifestSection }
