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
import { formatUtc } from '@/lib/format-date'

/** The one server call this panel makes, as a port — a test drives it with a plain function. */
export type RevokeMcpClient = (input: {
  readonly data: { readonly connectionId: string }
}) => Promise<boolean>

const REVOKE_FAILED = 'The connection could not be revoked'

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
    { failureMessage: REVOKE_FAILED }
  )

  return (
    <ListSection
      title="Connected clients"
      footer={<ActionFeedback error={act.error} />}
    >
      {connections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No clients connected</EmptyTitle>
            <EmptyDescription>
              No MCP client is connected to your account. Add this starter's MCP server
              in Claude or another MCP client and sign in when it asks; the connection
              will show up here.
            </EmptyDescription>
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
                        · workspace removed
                      </span>
                    )}
                  </ItemTitle>
                  <ItemDescription>
                    {connection.scopes.join(' ')} · since{' '}
                    {formatUtc(connection.grantedAt, { dateStyle: 'medium' })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-label={`Revoke ${label}`}
                        />
                      }
                    >
                      Revoke
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle>Revoke {label}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The client loses access to{' '}
                        {connection.workspace?.name ?? 'the workspace'} now, including
                        any token it still holds. It can ask to connect again.
                      </AlertDialogDescription>
                      <div className="flex justify-end gap-2">
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => act.run(connection.id)}>
                          Revoke access
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
