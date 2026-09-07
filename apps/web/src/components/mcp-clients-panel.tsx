import { type McpClientConnection } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { useServerAction } from '@/hooks/use-server-action'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { ActionFeedback } from '@/components/page/action-feedback'
import { ListSection } from '@/components/page/panel'
import { formatTimestamp } from '@/lib/format-date'
import { m } from '@b2b-saas-starter/i18n/messages'

/** The one server call this panel makes, as a port — a test drives it with a plain function. */
export type RevokeMcpClient = (input: {
  readonly data: { readonly connectionId: string }
}) => Promise<boolean>

/**
 * The account page's connected MCP clients (ADR 0068): every OAuth consent the
 * user holds, each bound to one workspace, with revoke. The list comes from
 * the route loader, so a successful revoke invalidates the route rather than
 * keeping its own copy.
 */
export function McpClientsPanel({
  connections,
  revoke
}: {
  readonly connections: ReadonlyArray<McpClientConnection>
  readonly revoke: RevokeMcpClient
}) {
  const act = useServerAction(
    (connectionId: string) => revoke({ data: { connectionId } }),
    { failureMessage: m.mcp_connection_revoke_failed() }
  )

  return (
    <ListSection
      title={m.connected_clients()}
      footer={<ActionFeedback error={act.error} />}
    >
      {connections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{m.empty_no_clients()}</EmptyTitle>
            <EmptyDescription>{m.mcp_empty_description()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {connections.map((connection) => {
            const label = connection.client.name ?? connection.client.clientId
            const busy = act.pending && act.pendingInput === connection.id
            return (
              <Item key={connection.id} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>
                    {label}
                    {connection.workspace ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · {connection.workspace.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {' '}
                        · {m.workspace_removed()}
                      </span>
                    )}
                  </ItemTitle>
                  <ItemDescription>
                    {connection.scopes.join(' ')} · since{' '}
                    {formatTimestamp(connection.grantedAt, { dateStyle: 'medium' })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="ghost"
                          disabled={busy}
                          aria-label={`Revoke ${label}`}
                        />
                      }
                    >
                      {m.action_revoke()}
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle>
                        {m.revoke_named({ name: label })}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {m.mcp_revoke_description({
                          workspace: connection.workspace?.name ?? m.the_workspace()
                        })}
                      </AlertDialogDescription>
                      <div className="flex justify-end gap-2">
                        <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => act.run(connection.id)}>
                          {m.revoke_access()}
                        </AlertDialogAction>
                      </div>
                    </AlertDialogContent>
                  </AlertDialog>
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      )}
    </ListSection>
  )
}
