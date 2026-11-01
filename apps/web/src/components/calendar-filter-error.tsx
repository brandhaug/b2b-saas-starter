import { useParams, useRouter } from '@tanstack/react-router'
import { m } from '@b2b-saas-starter/i18n/messages'
import { type UiError } from '@/lib/ui-error'
import { causeMessage } from '@/lib/cause-message'
import { WorkspaceShell } from './workspace-shell'
import { Button } from './ui/button'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './ui/empty'

/** Recovery for the server-filtered audit and failed-delivery pages. */
export function CalendarFilterError({ error }: { readonly error: UiError }) {
  const router = useRouter()
  const { workspaceSlug } = useParams({ strict: false })
  return (
    <WorkspaceShell workspaceSlug={workspaceSlug ?? null} viewer={null}>
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <h1>{m.shell_calendar_filter_title()}</h1>
          </EmptyTitle>
          <EmptyDescription>
            {causeMessage(error, m.shell_error_description())}
          </EmptyDescription>
        </EmptyHeader>
        <Button
          variant="outline"
          onClick={() => {
            void router.navigate({
              to: '.',
              replace: true,
              search: (previous) => {
                const next = { ...previous }
                if (workspaceSlug === undefined) {
                  delete next.failureView
                  delete next.failureCursor
                } else {
                  delete next.since
                  delete next.until
                  delete next.view
                  delete next.cursor
                }
                return next
              }
            })
          }}
        >
          {m.shell_clear_calendar_filters()}
        </Button>
      </Empty>
    </WorkspaceShell>
  )
}
