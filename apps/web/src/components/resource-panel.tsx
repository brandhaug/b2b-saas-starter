import { type ReactNode } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { ItemGroup } from '@/components/ui/item'

/**
 * The part of `useServerAction`'s result this frame reads. Panels hand their
 * mutations in whole; the frame only ever asks them whether they failed.
 */
export type PanelAction = {
  readonly error: string | null
}

/**
 * The shape both developer-platform panels share: a create section that turns
 * into a reason when the viewer's role cannot create, a titled list that falls
 * back to an empty state, and one destructive alert at the bottom carrying
 * whichever mutation failed.
 *
 * Presentation only. `create.allowed` decides between the form and its reason;
 * it is `viewerCan(...)` at every call site and never a role name, and the
 * server re-checks the permission in the server fn regardless.
 */
export function ResourcePanel({
  create,
  list,
  actions
}: {
  readonly create: {
    readonly title: string
    readonly allowed: boolean
    readonly form: ReactNode
    /** Shown in the form's place when the viewer's role cannot create. */
    readonly deniedReason: string
  }
  readonly list: {
    readonly title: string
    /** One rendered row per resource; empty means the empty state. */
    readonly items: ReadonlyArray<ReactNode>
    readonly empty: {
      readonly title: string
      readonly description: string
    }
    /** Trailing copy under the list, such as a denied-action reason. */
    readonly footer?: ReactNode
  }
  /** The panel's mutations. The first one carrying a failure is displayed. */
  readonly actions: ReadonlyArray<PanelAction>
}) {
  const error = actions
    .map((action) => action.error)
    .find((message) => message !== null)

  return (
    <div className="grid gap-6">
      {create.allowed ? (
        <div className="grid gap-2">
          <h2 className="text-sm font-medium">{create.title}</h2>
          {create.form}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{create.deniedReason}</p>
      )}

      <div className="grid gap-2">
        <h2 className="text-sm font-medium">{list.title}</h2>
        {list.items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{list.empty.title}</EmptyTitle>
              <EmptyDescription>{list.empty.description}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup>{list.items}</ItemGroup>
        )}
        {list.footer}
      </div>

      {error === undefined ? null : (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
